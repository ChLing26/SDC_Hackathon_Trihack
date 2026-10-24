import { test } from "node:test";
import assert from "node:assert/strict";
import { attachElectronicSignature, attachSupplierSignature } from "./invoice-signature";
import { createHash } from "node:crypto";

const invoice = {
  id: 999, reference: "INV-TEST", requestId: 999, itemName: "Paper", quantity: 10,
  supplierName: "Supplier", buyerName: "Buyer", unitPrice: 2, shippingFee: 3,
  totalAmount: 23, currency: "MYR", issuedAt: new Date("2026-10-22T00:00:00.000Z"),
  signature: "original-hash", signatureType: "Integrity hash",
};
const account = { id: 42, name: "Test Signer", email: "test@example.test" };
const at = new Date("2026-10-22T12:00:00.000Z");

test("records trimmed name, account identity, time and consent without modifying invoice", () => {
  const result = attachElectronicSignature(invoice, "  Test Signer  ", account, at);
  assert.equal(result.electronicSignature?.typedName, "Test Signer");
  assert.equal(result.electronicSignature?.accountId, 42);
  assert.equal(result.electronicSignature?.signedAt.toISOString(), at.toISOString());
  assert.equal(result.electronicSignature?.consentVersion, "invoice-signature-v1");
  assert.match(result.electronicSignature!.documentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.totalAmount, 23);
  assert.equal(result.signature, "original-hash");
  assert.equal("electronicSignature" in invoice, false);
});
test("hash binds invoice values and signing identity", () => {
  const original = attachElectronicSignature(invoice, "Test Signer", account, at).electronicSignature!.documentHash;
  assert.notEqual(original, attachElectronicSignature({ ...invoice, totalAmount: 24 }, "Test Signer", account, at).electronicSignature!.documentHash);
  assert.notEqual(original, attachElectronicSignature(invoice, "Test Signer", { ...account, id: 43 }, at).electronicSignature!.documentHash);
});
test("rejects overwriting an existing signature and invalid names", () => {
  const signed = attachElectronicSignature(invoice, "Test Signer", account, at);
  assert.throws(() => attachElectronicSignature(signed, "Other Signer", account), /already signed/);
  for (const name of [" ", "x", "x".repeat(121)]) {
    assert.throws(() => attachElectronicSignature(invoice, name, account), /Invalid signature name/);
  }
});

test("legacy account hash algorithm and evidence are unchanged", () => {
  const signed = attachElectronicSignature(invoice, "Test Signer", account, at);
  const { documentHash, ...metadata } = signed.electronicSignature!;
  assert.equal(documentHash, createHash("sha256").update(JSON.stringify({ invoice, signature: metadata })).digest("hex"));
  const both = attachSupplierSignature(signed, " Supplier Person ", account, at);
  assert.deepEqual(both.electronicSignature, signed.electronicSignature);
  assert.equal(both.signature, invoice.signature);
  assert.equal(both.supplierSignature?.typedName, "Supplier Person");
  assert.equal(both.supplierSignature?.supplierName, invoice.supplierName);
  assert.equal(both.supplierSignature?.recordingAccountId, account.id);
  assert.equal(both.supplierSignature?.recordedAt.toISOString(), at.toISOString());
  assert.equal(both.supplierSignature?.consentVersion, "invoice-supplier-signature-v1");
});

test("either signing order preserves independent evidence and hashes", () => {
  const supplierFirst = attachSupplierSignature(invoice, "Supplier Person", account, at);
  const accountFirst = attachElectronicSignature(invoice, "Test Signer", account, at);
  const a = attachElectronicSignature(supplierFirst, "Test Signer", account, at);
  const b = attachSupplierSignature(accountFirst, "Supplier Person", account, at);
  assert.deepEqual(a, b);
  assert.deepEqual(a.supplierSignature, supplierFirst.supplierSignature);
  assert.deepEqual(b.electronicSignature, accountFirst.electronicSignature);
  assert.throws(() => attachSupplierSignature(a, "Replacement", account), /already recorded/);
});

test("supplier evidence binds content, supplier, recorder, representative, time and consent", () => {
  const hash = (inv = invoice, name = "Supplier Person", recorder = account, time = at) =>
    attachSupplierSignature(inv, name, recorder, time).supplierSignature!.documentHash;
  const original = hash();
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(original, hash({ ...invoice, supplierName: "Other Supplier" }));
  assert.notEqual(original, hash({ ...invoice, totalAmount: 24 }));
  assert.notEqual(original, hash(invoice, "Other Person"));
  assert.notEqual(original, hash(invoice, "Supplier Person", { ...account, id: 43 }));
  assert.notEqual(original, hash(invoice, "Supplier Person", account, new Date(+at + 1)));
  for (const name of [" ", "x", "x".repeat(121)]) {
    assert.throws(() => attachSupplierSignature(invoice, name, account), /Invalid signature name/);
  }
});
