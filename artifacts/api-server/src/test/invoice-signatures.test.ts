import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { db, pool, accounts, authAttempts, procurementRecords } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { GetProcurementRequestResponse, SignProcurementInvoiceResponse } from "@workspace/api-zod";
import app from "../app";
import { createRecord } from "../lib/procurement";
import { digest } from "../lib/auth";

test("immutable independent invoice signatures over authenticated API", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const email = `signature-${randomUUID()}@example.test`;
  const ids: number[] = [];
  const ip = "198.51.100.240";
  let cookie = "";
  const request = (path: string, data?: unknown, authenticated = true) => fetch(`${base}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-procureflow-request": "1",
      "x-forwarded-for": ip, ...(authenticated ? { cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const sign = (id: number, supplier: boolean, data: unknown = { typedName: "  Representative Name  ", consent: true }, authenticated = true) =>
    request(`/procurement/invoices/${id}/${supplier ? "supplier-signature" : "signature"}`, data, authenticated);
  const stored = async (id: number) => {
    const [row] = await db.select().from(procurementRecords).where(eq(procurementRecords.id, id));
    return row.data as Record<string, unknown> & { invoice: Record<string, unknown> };
  };
  const fixture = async () => {
    const record = await createRecord({ itemName: "Signature test paper", quantity: 10, budgetAmount: 100,
      currency: "MYR", requiredDeliveryDate: "2026-12-31", deliveryLocation: "Test Office", requesterName: "Test Buyer" });
    ids.push(record.id);
    const approved = await request(`/procurement/requests/${record.id}/decision`,
      { offerId: record.offers[0].id, decision: "approved", managerName: "Test Manager" });
    assert.equal(approved.status, 200);
    // Approval currently sends its response inside its transaction. Wait for
    // that transaction's row lock before capturing fixtures or injecting errors.
    await db.transaction(async tx => {
      await tx.select().from(procurementRecords).where(eq(procurementRecords.id, record.id)).for("update");
    });
    return GetProcurementRequestResponse.parse(await approved.json()).invoice!;
  };
  try {
    const registration = await request("/auth/register", { name: "Recording Account", email,
      password: "Signature-test-passphrase-2026", passwordConfirmation: "Signature-test-passphrase-2026" }, false);
    assert.equal(registration.status, 201);
    const account = await registration.json() as { id: number };
    cookie = registration.headers.get("set-cookie")!.split(";")[0];
    await t.test("old unsigned invoices, validation, authentication and missing invoices", async () => {
      const invoice = await fixture();
      assert.equal(invoice.electronicSignature, undefined);
      assert.equal(invoice.supplierSignature, undefined);
      for (const supplier of [false, true]) {
        assert.equal((await sign(invoice.id, supplier, undefined, false)).status, 401);
        for (const data of [{ typedName: " ", consent: true }, { typedName: "x", consent: true },
          { typedName: "x".repeat(121), consent: true }, { typedName: 12, consent: true },
          { typedName: "Valid Person", consent: false }, { typedName: "Valid Person" },
          { typedName: "Valid Person", consent: "true" }]) {
          assert.equal((await sign(invoice.id, supplier, data)).status, 400);
        }
        assert.equal((await sign(2147483647, supplier)).status, 404);
        assert.equal((await sign(0, supplier)).status, 400);
      }
      assert.equal((await stored(invoice.id)).invoice.signature, invoice.signature);
    });
    for (const supplierFirst of [false, true]) {
      await t.test(`${supplierFirst ? "supplier" : "account"} first retains exact raw evidence`, async () => {
        const invoice = await fixture();
        assert.equal((await sign(invoice.id, supplierFirst)).status, 200);
        const before = await stored(invoice.id);
        // Unknown legacy metadata must survive schema parsing on subsequent saves.
        before.invoice.legacyEvidence = { hash: "unchanged", time: "original-format" };
        const key = supplierFirst ? "supplierSignature" : "electronicSignature";
        (before.invoice[key] as Record<string, unknown>).legacyEvidence = "keep exactly";
        await db.update(procurementRecords).set({ data: before }).where(eq(procurementRecords.id, invoice.id));
        const response = await sign(invoice.id, !supplierFirst);
        assert.equal(response.status, 200);
        const both = SignProcurementInvoiceResponse.parse(await response.json());
        assert.equal(both.supplierSignature?.typedName, "Representative Name");
        assert.equal(both.supplierSignature?.recordingAccountId, account.id);
        assert.equal(both.supplierSignature?.supplierName, invoice.supplierName);
        const after = await stored(invoice.id);
        assert.deepEqual(after.invoice[key], before.invoice[key]);
        assert.deepEqual(after.invoice.legacyEvidence, before.invoice.legacyEvidence);
        assert.equal(after.invoice.signature, invoice.signature);
        assert.equal((await sign(invoice.id, true)).status, 409);
        assert.equal((await sign(invoice.id, false)).status, 409);
        assert.deepEqual(await stored(invoice.id), after);
        const reloaded = GetProcurementRequestResponse.parse(await (await request(`/procurement/requests/${invoice.id}`)).json());
        assert.deepEqual(reloaded.invoice, both);
      });
    }
    await t.test("simultaneous cross-signatures both persist; competing duplicates cannot replace", async () => {
      const invoice = await fixture();
      const responses = await Promise.all([sign(invoice.id, false), sign(invoice.id, true)]);
      assert.deepEqual(responses.map(r => r.status), [200, 200]);
      const row = await stored(invoice.id);
      assert.ok(row.invoice.electronicSignature);
      assert.ok(row.invoice.supplierSignature);
      const duplicate = await fixture();
      const competing = await Promise.all([sign(duplicate.id, true, { typedName: "First Person", consent: true }),
        sign(duplicate.id, true, { typedName: "Second Person", consent: true })]);
      assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
      const winner = SignProcurementInvoiceResponse.parse(await competing.find(r => r.status === 200)!.json());
      assert.deepEqual((await stored(duplicate.id)).invoice.supplierSignature,
        JSON.parse(JSON.stringify(winner.supplierSignature)));
    });
    await t.test("temporary failure is recoverable without partially saving", async () => {
      const invoice = await fixture();
      const before = await stored(invoice.id);
      const transaction = t.mock.method(db, "transaction", async () => { throw new Error("test failure"); });
      try { assert.equal((await sign(invoice.id, true)).status, 503); }
      finally { transaction.mock.restore(); }
      assert.deepEqual(await stored(invoice.id), before);
      assert.equal((await sign(invoice.id, true)).status, 200);
    });
  } finally {
    if (ids.length) await db.delete(procurementRecords).where(inArray(procurementRecords.id, ids));
    await db.delete(accounts).where(eq(accounts.email, email));
    await db.delete(authAttempts).where(inArray(authAttempts.key, [`ip:${digest(ip)}`, `email:${digest(email)}`]));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
