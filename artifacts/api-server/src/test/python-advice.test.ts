import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { GetProcurementAdviceResponse, GetProcurementRequestResponse } from "@workspace/api-zod";
import { AdviceError, buildAdvicePayload, createPythonAdviceClient } from "../lib/python-advice";
import { createAdviceHandler } from "../routes/python-advice";
import { requireAccount, sameOrigin } from "../lib/auth";

// Deliberately not a project secret. No test queries or writes the project DB.
const TOKEN = "fixture-service-token-not-a-real-secret-1234";
const NOW = Date.parse("2026-10-23T12:00:00Z");
const fixture = () => GetProcurementRequestResponse.parse({
  id: 71, itemName: "Fixture pens", quantity: 3, budgetAmount: 20, currency: "MYR",
  requiredDeliveryDate: "2026-10-25", deliveryLocation: "Fixture city", requesterName: "Display label",
  status: "pending_approval", offerCount: 2, selectedSupplier: null, createdAt: "2026-10-23T00:00:00Z",
  selectedOfferId: null, managerName: null, managerComment: null, invoice: null,
  offers: [
    { id: 711, supplierName: "Same display name", supplierLocation: "City", unitPrice: 2.35, shippingFee: 4.25,
      totalPrice: 11.3, currency: "MYR", deliveryDays: 2, distanceKm: 20, reliability: 4.7, overallScore: 70,
      priceScore: 70, speedScore: 70, proximityScore: 70, reliabilityScore: 70, rank: 1 },
    { id: 712, supplierName: "Same display name", supplierLocation: "City", unitPrice: 8, shippingFee: 5,
      totalPrice: 29, currency: "MYR", deliveryDays: 3, distanceKm: 80, reliability: 4.7, overallScore: 60,
      priceScore: 60, speedScore: 60, proximityScore: 60, reliabilityScore: 60, rank: 2 },
  ],
});
function reply(record = fixture()) {
  const { payload } = buildAdvicePayload(record, {}, NOW);
  return {
    status: "success", supplier_count: payload.suppliers.length, warning_count: 0,
    ai_status: "success", ai_advice: "Fixture advice", warnings: [] as Array<{
      quote_id: string; supplier: string; type: string; severity: string; message: string;
    }>,
    suppliers: payload.suppliers.map(s => ({
      ...s, reported_total_cost_rm: s.total_cost_rm,
      total_cost_rm: Math.round((s.product_price_rm + s.shipping_rm) * 100) / 100,
      within_budget: s.product_price_rm + s.shipping_rm <= payload.budget,
      meets_delivery_requirement: s.delivery_days <= payload.max_delivery_days,
      anomalies: [] as Array<{ quote_id: string; supplier: string; type: string; severity: string; message: string }>,
    })),
  };
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const client = (response = reply()) => createPythonAdviceClient({
  token: () => TOKEN, fetch: async () => json(response),
});
const fails = (status: number) => (error: unknown) => error instanceof AdviceError && error.status === status;

test("persisted unit price × quantity, shipping once, stable IDs and separate eligibility", async () => {
  const original = fixture();
  const before = JSON.stringify(original);
  const { payload } = buildAdvicePayload(original, { priority: "lowest_cost" }, NOW);
  assert.equal(payload.suppliers[0].product_price_rm, 7.05);
  assert.equal(payload.suppliers[0].shipping_rm, 4.25);
  assert.equal(payload.suppliers[0].total_cost_rm, 11.3);
  assert.equal(payload.priority, "lowest_cost");
  assert.equal(payload.max_delivery_days, 2);
  assert.notEqual(payload.suppliers[0].quote_id, payload.suppliers[1].quote_id);
  const result = await client()(original, {}, NOW);
  assert.equal(result.suppliers[0].totalPrice, 11.3);
  assert.equal(result.suppliers[0].withinBudget, true);
  assert.equal(result.suppliers[0].meetsDeliveryRequirement, true);
  assert.equal(result.suppliers[1].withinBudget, false);
  assert.equal(result.suppliers[1].meetsDeliveryRequirement, false);
  assert.equal(JSON.stringify(original), before);
});

test("fixed loopback URL, private bearer and redirect refusal", async () => {
  const call = createPythonAdviceClient({ token: () => TOKEN, fetch: async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8000/supplier-advice");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(options?.credentials, undefined);
    return json(reply());
  } });
  await call(fixture(), {}, NOW);
});

test("missing/short runtime config fails without making an upstream call", async () => {
  for (const token of [undefined, "", "short"]) {
    const call = createPythonAdviceClient({ token: () => token, fetch: async () => { throw new Error("Must not call"); } });
    await assert.rejects(call(fixture(), {}, NOW), fails(503));
  }
});

test("timeout aborts the request and never leaks transport exceptions", async () => {
  let signal: AbortSignal | null | undefined;
  const call = createPythonAdviceClient({
    token: () => TOKEN, timeoutMs: 15,
    fetch: async (_url, options) => { signal = options?.signal; return new Promise<Response>(() => {}); },
  });
  await assert.rejects(call(fixture(), {}, NOW), fails(504));
  assert.equal(signal?.aborted, true);
  const failed = createPythonAdviceClient({ token: () => TOKEN, fetch: async () => { throw new Error(TOKEN); } });
  await assert.rejects(failed(fixture(), {}, NOW), (e: unknown) => e instanceof AdviceError && !e.message.includes(TOKEN));
});

test("invalid JSON, content type, shape and oversized bodies are rejected safely", async () => {
  for (const response of [
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response("<html>private diagnostic</html>"),
    () => json({ unexpected: TOKEN }),
    () => json({ extra: "x".repeat(600_000) }),
  ]) {
    const call = createPythonAdviceClient({ token: () => TOKEN, fetch: async () => response() });
    await assert.rejects(call(fixture(), {}, NOW), fails(502));
  }
});

test("upstream authentication or provider HTTP error bodies are not forwarded", async () => {
  for (const status of [401, 422, 429, 500, 503]) {
    const call = createPythonAdviceClient({ token: () => TOKEN, fetch: async () => new Response(TOKEN, { status }) });
    await assert.rejects(call(fixture(), {}, NOW), (e: unknown) => e instanceof AdviceError && e.status === 503 && !e.message.includes(TOKEN));
  }
});

test("response must match stored quote IDs, names, totals, eligibility and counts", async () => {
  const mutations = [
    (r: ReturnType<typeof reply>) => { r.suppliers[0].quote_id = "unknown"; },
    (r: ReturnType<typeof reply>) => { r.suppliers[0].name = "Browser supplier"; },
    (r: ReturnType<typeof reply>) => { r.suppliers[0].total_cost_rm = 1; },
    (r: ReturnType<typeof reply>) => { r.suppliers[0].within_budget = false; },
    (r: ReturnType<typeof reply>) => { r.suppliers[0].meets_delivery_requirement = false; },
    (r: ReturnType<typeof reply>) => { r.supplier_count = 3; },
    (r: ReturnType<typeof reply>) => { r.suppliers[1] = r.suppliers[0]; },
  ];
  for (const mutate of mutations) {
    const r = reply(); mutate(r);
    await assert.rejects(client(r)(fixture(), {}, NOW), fails(502));
  }
});

test("AI failure/unavailability preserves deterministic warnings and quote attribution", async () => {
  for (const status of ["failed", "unavailable"]) {
    const r = reply();
    r.ai_status = status; r.ai_advice = TOKEN;
    const warning = { quote_id: r.suppliers[1].quote_id, supplier: r.suppliers[1].name,
      type: "TOTAL_COST_MISMATCH", severity: "high", message: "Fixture mismatch" };
    r.warnings = [warning]; r.warning_count = 1; r.suppliers[1].anomalies = [warning];
    const result = await client(r)(fixture(), {}, NOW);
    assert.equal(result.aiStatus, status);
    assert.equal(result.warnings[0].offerId, 712);
    assert.equal(result.suppliers[0].anomalies.length, 0);
    assert.equal(result.suppliers[1].anomalies.length, 1);
    assert.equal(result.advice?.includes(TOKEN), false);
  }
});

test("adapter wire contract matches real FastAPI validation with AI disabled and no database", async () => {
  const record = fixture();
  record.offers[0].totalPrice = 1; // Intentionally preserve a reported-total anomaly.
  const call = createPythonAdviceClient({ token: () => TOKEN, fetch: async (_url, options) => {
    const output = execFileSync("python", ["-c", [
      "import json,sys,os",
      "from fastapi.testclient import TestClient",
      "from api import app",
      "with TestClient(app) as c:",
      " r=c.post('/supplier-advice',json=json.load(sys.stdin),headers={'Authorization':'Bearer '+os.environ['PYTHON_BACKEND_TOKEN']})",
      " print(json.dumps({'status':r.status_code,'body':r.json()}))",
    ].join("\n")], {
      cwd: path.resolve(import.meta.dirname, "../../../.."), input: String(options?.body),
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PYTHON_BACKEND_TOKEN: TOKEN, GEMINI_API_KEY: "", DATABASE_URL: "", PYTHON_SQLITE_PATH: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = JSON.parse(output) as { status: number; body: unknown };
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  } });
  const result = await call(record, {}, NOW);
  assert.equal(result.aiStatus, "unavailable");
  assert.equal(result.suppliers[0].totalPrice, 11.3);
  assert.equal(result.warnings[0].offerId, 711);
  assert.equal(result.warnings[0].type, "TOTAL_COST_MISMATCH");
});

test("real Gemini error handling through FastAPI and adapter preserves checks without leaking provider details", async () => {
  for (const failure of ["quota", "denied", "timeout", "empty"]) {
    const record = fixture();
    record.offers[0].totalPrice = 1;
    const call = createPythonAdviceClient({ token: () => TOKEN, fetch: async (_url, options) => {
      const output = execFileSync("python", ["-c", [
        "import json,sys,os",
        "from unittest.mock import Mock,patch",
        "from google.genai.errors import ClientError",
        "from fastapi.testclient import TestClient",
        "from api import app",
        "client=Mock()",
        "mode=sys.argv[1]",
        "if mode=='empty': client.models.generate_content.return_value.text=''",
        "elif mode=='timeout': client.models.generate_content.side_effect=TimeoutError('fixture-private-provider-detail')",
        "else: client.models.generate_content.side_effect=ClientError(429 if mode=='quota' else 403, {'error':{'message':'fixture-private-provider-detail','status':'RESOURCE_EXHAUSTED' if mode=='quota' else 'PERMISSION_DENIED'}})",
        "with patch('ai_advisor.client',client), TestClient(app) as c:",
        " r=c.post('/supplier-advice',json=json.load(sys.stdin),headers={'Authorization':'Bearer '+os.environ['PYTHON_BACKEND_TOKEN']})",
        " assert client.models.generate_content.call_count==1",
        " assert r.json()['ai_status']=='failed'",
        " assert 'fixture-private-provider-detail' not in r.text",
        " print(json.dumps({'status':r.status_code,'body':r.json()}))",
      ].join("\n"), failure], {
        cwd: path.resolve(import.meta.dirname, "../../../.."), input: String(options?.body),
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PYTHON_BACKEND_TOKEN: TOKEN, GEMINI_API_KEY: "", DATABASE_URL: "", PYTHON_SQLITE_PATH: "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const result = JSON.parse(output) as { status: number; body: unknown };
      assert.equal(result.status, 200);
      return json(result.body);
    } });
    const result = await call(record, {}, NOW);
    assert.equal(result.aiStatus, "failed");
    assert.equal(result.advice, "AI advice is unavailable. Eligibility and anomaly checks are still available.");
    assert.equal(result.suppliers[0].totalPrice, 11.3);
    assert.equal(result.suppliers[0].withinBudget, true);
    assert.equal(result.suppliers[1].withinBudget, false);
    assert.equal(result.suppliers[1].meetsDeliveryRequirement, false);
    assert.equal(result.warnings[0].offerId, 711);
    assert.equal(result.warnings[0].type, "TOTAL_COST_MISMATCH");
  }
});

test("non-MYR, duplicate IDs, unsafe numeric values and invalid precision rejected before transport", () => {
  const currency = fixture(); currency.currency = "USD";
  assert.throws(() => buildAdvicePayload(currency, {}, NOW), fails(422));
  for (const bad of [NaN, Infinity, -1, 0.001, 1e13]) {
    const record = fixture(); record.offers[0].unitPrice = bad;
    assert.throws(() => buildAdvicePayload(record, {}, NOW), fails(422));
  }
  const duplicate = fixture(); duplicate.offers[1].id = duplicate.offers[0].id;
  assert.throws(() => buildAdvicePayload(duplicate, {}, NOW), fails(422));
  const huge = fixture(); huge.quantity = 1e9; huge.offers[0].unitPrice = 1e12;
  assert.throws(() => buildAdvicePayload(huge, {}, NOW), fails(422));
});

test("expired deadlines never become eligible, including zero-day estimates", async () => {
  const record = fixture(); record.requiredDeliveryDate = new Date("2026-10-01"); record.offers[0].deliveryDays = 0;
  const r = reply(record);
  const result = await client(r)(record, {}, NOW);
  assert.equal(result.maxDeliveryDays, 0);
  assert.equal(result.deadlinePassed, true);
  assert.equal(result.suppliers[0].meetsDeliveryRequirement, false);
});

test("Express boundary rejects unauthenticated users, browser authority, invalid IDs; loads only persisted data", async () => {
  const app = express();
  app.use(express.json(), cookieParser(), sameOrigin);
  let loads = 0, called = 0;
  const handler = createAdviceHandler(async id => { loads++; return id === 71 ? fixture() : undefined; }, async (record) => {
    called++; assert.equal(record.offers[0].supplierName, "Same display name");
    return client()(record, {}, NOW);
  });
  // Real authentication middleware for the unsigned path; valid-session path is
  // injected to exercise the advice handler without creating an account/session.
  app.post("/unsigned/:requestId/advice", requireAccount, handler);
  app.post("/signed/:requestId/advice", handler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (path: string, data: unknown) => fetch(base + path, { method: "POST",
      headers: { "content-type": "application/json", "x-procureflow-request": "1" }, body: JSON.stringify(data) });
    assert.equal((await request("/unsigned/71/advice", {})).status, 401);
    assert.equal(loads, 0);
    for (const data of [{ suppliers: [] }, { unitPrice: 0 }, { supplierName: "Injected" }, { buyerId: 7 },
      { totalPrice: 1 }, { managerName: "Manager" }, { priority: "invalid" }, { url: "https://example.test" }]) {
      assert.equal((await request("/signed/71/advice", data)).status, 400);
    }
    for (const id of ["0", "-1", "1.5", "NaN"]) assert.equal((await request(`/signed/${id}/advice`, {})).status, 400);
    assert.equal(loads, 0);
    assert.equal((await request("/signed/72/advice", {})).status, 404);
    const result = await request("/signed/71/advice", {});
    assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(GetProcurementAdviceResponse.parse(await result.json()).suppliers[0].productSubtotal, 7.05);
    assert.equal(called, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
