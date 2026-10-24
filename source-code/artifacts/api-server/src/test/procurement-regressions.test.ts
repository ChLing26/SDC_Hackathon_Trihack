import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import { GetProcurementRequestResponse } from "@workspace/api-zod";
import app from "../app";

const isolated = process.env.PROCUREMENT_ISOLATED_TESTS === "1";

test("retired Tools API endpoints remain unavailable", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const retiredEndpoints = [
    { method: "GET", path: "/tools/capabilities" },
    { method: "GET", path: "/tools/secrets" },
    { method: "POST", path: "/tools/secrets", body: { name: "EXAMPLE", key: "example" } },
    { method: "PUT", path: "/tools/secrets/EXAMPLE", body: { key: "example" } },
    { method: "DELETE", path: "/tools/secrets/EXAMPLE" },
  ] as const;
  try {
    for (const endpoint of retiredEndpoints) {
      const body = "body" in endpoint ? endpoint.body : undefined;
      const response = await fetch(base + endpoint.path, {
        method: endpoint.method,
        headers: {
          "x-procureflow-request": "1",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.status, 404, `${endpoint.method} ${endpoint.path}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

// These tests install deferred constraint triggers. Never run on a project DB.
test("procurement numeric and commit-order regressions", {
  skip: isolated ? false : "Requires the disposable PostgreSQL test runner",
}, async t => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.match(target.searchParams.get("host") ?? "", /^\/tmp\/backend-review-pg-[^/]+\/socket$/);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = "";
  const request = (path: string, data?: unknown) => fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-procureflow-request": "1", cookie },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const input = {
    itemName: "Isolated numeric fixture", quantity: 10, budgetAmount: 500,
    currency: "MYR", requiredDeliveryDate: "2026-12-31",
    deliveryLocation: "Fixture office", requesterName: "Fixture buyer",
  };
  const fixture = async () => {
    const response = await request("/procurement/requests", input);
    assert.equal(response.status, 201);
    return GetProcurementRequestResponse.parse(await response.json());
  };
  const approve = (record: { id: number; offers: { id: number }[] }) =>
    request(`/procurement/requests/${record.id}/decision`, {
      decision: "approved", managerName: "Self-entered fixture manager", offerId: record.offers[0]!.id,
    });
  const stored = async (id: number) => (await pool.query(
    "SELECT data FROM procurement_records WHERE id=$1", [id],
  )).rows[0].data;
  const deferredTrigger = async (id: number, body: string) => {
    const name = "review_" + randomUUID().replaceAll("-", "");
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN ${body}; RETURN NEW; END $$`);
    await pool.query(`CREATE CONSTRAINT TRIGGER ${name}
      AFTER UPDATE ON procurement_records DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.id = ${id} AND NEW.data->>'status' = 'approved')
      EXECUTE FUNCTION ${name}()`);
    return async () => {
      await pool.query(`DROP TRIGGER ${name} ON procurement_records`);
      await pool.query(`DROP FUNCTION ${name}()`);
    };
  };
  try {
    const registered = await request("/auth/register", {
      name: "Isolated regression account", email: `regression-${randomUUID()}@example.test`,
      password: "Isolated-only-regression-passphrase",
      passwordConfirmation: "Isolated-only-regression-passphrase",
    });
    assert.equal(registered.status, 201);
    cookie = registered.headers.get("set-cookie")!.split(";")[0]!;

    await t.test("extreme numeric inputs are rejected before record creation", async () => {
      const before = (await pool.query("SELECT count(*) FROM procurement_records")).rows;
      for (const data of [
        { ...input, budgetAmount: 1e308 }, { ...input, budgetAmount: 1e12 + 1 },
        { ...input, quantity: 1e9 + 1 },
      ]) assert.equal((await request("/procurement/requests", data)).status, 400);
      assert.deepEqual((await pool.query("SELECT count(*) FROM procurement_records")).rows, before);
    });
    await t.test("supported boundary prices and scores remain finite", async () => {
      const response = await request("/procurement/requests", {
        ...input, budgetAmount: 1e12, quantity: 1e9,
      });
      assert.equal(response.status, 201);
      const record = GetProcurementRequestResponse.parse(await response.json());
      for (const offer of record.offers) {
        for (const field of ["unitPrice", "shippingFee", "totalPrice", "overallScore"] as const) {
          assert.ok(Number.isFinite(offer[field]), field);
        }
        assert.equal(offer.totalPrice, Math.round(
          (offer.unitPrice * record.quantity + offer.shippingFee) * 100,
        ) / 100);
        assert.equal(offer.overallScore, Math.round(
          (offer.priceScore + offer.speedScore + offer.proximityScore + offer.reliabilityScore) / 4 * 100,
        ) / 100);
      }
    });
    await t.test("a real deferred COMMIT failure returns 503 and rolls back approval", async () => {
      const record = await fixture();
      const before = await stored(record.id);
      const remove = await deferredTrigger(record.id, "RAISE EXCEPTION 'isolated commit failure'");
      try {
        const response = await approve(record);
        assert.equal(response.status, 503);
        assert.deepEqual(await stored(record.id), before);
        assert.ok(!(await response.text()).includes("isolated commit failure"));
      } finally { await remove(); }
      const retry = await approve(record);
      assert.equal(retry.status, 200);
      const invoice = GetProcurementRequestResponse.parse(await retry.json()).invoice;
      assert.ok(invoice);
      assert.equal((await stored(record.id)).invoice.reference, invoice.reference);
    });
    await t.test("no success headers arrive while the actual COMMIT is blocked", async () => {
      const record = await fixture();
      const key = randomInt(1, 2_000_000_000);
      const blocker = await pool.connect();
      const remove = await deferredTrigger(record.id, `PERFORM pg_advisory_xact_lock(${key})`);
      await blocker.query("SELECT pg_advisory_lock($1)", [key]);
      let responseArrived = false;
      const pending = approve(record).then(response => { responseArrived = true; return response; });
      try {
        let waiting = false;
        for (let attempts = 0; attempts < 100; attempts++) {
          waiting = (await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1::oid AND NOT granted", [key],
          )).rowCount! > 0;
          if (waiting) break;
          await delay(25);
        }
        assert.ok(waiting, "Approval must reach the deferred COMMIT trigger");
        await delay(50);
        assert.equal(responseArrived, false, "Response cannot precede transaction commit");
      } finally {
        await blocker.query("SELECT pg_advisory_unlock($1)", [key]);
        blocker.release();
        await pending;
        await remove();
      }
      const response = await pending;
      assert.equal(response.status, 200);
      assert.equal((await stored(record.id)).status, "approved");
    });
    await t.test("concurrent decisions produce exactly one committed approval", async () => {
      const record = await fixture();
      const responses = await Promise.all([approve(record), approve(record)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
      const before = await stored(record.id);
      assert.equal((await approve(record)).status, 400);
      assert.deepEqual(await stored(record.id), before);
    });
    await t.test("missing request validation returns after the transaction without mutation", async () => {
      const response = await request("/procurement/requests/2147483647/decision", {
        decision: "approved", managerName: "Fixture manager", offerId: 1,
      });
      assert.equal(response.status, 404);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
