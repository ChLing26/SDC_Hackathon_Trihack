import { createHash } from "node:crypto";
import type { GetCurrentUserResponse, GetProcurementRequestResponse } from "@workspace/api-zod";

type Account = ReturnType<typeof GetCurrentUserResponse.parse>;
type Invoice = NonNullable<ReturnType<typeof GetProcurementRequestResponse.parse>["invoice"]>;

/** An internal consent record, not a certificate-backed digital signature. */
export function attachElectronicSignature(
  invoice: Invoice,
  typedName: string,
  account: Account,
  now = new Date(),
): Invoice {
  if (invoice.electronicSignature) throw new Error("Invoice already signed");
  const name = typedName.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Invalid signature name");
  const metadata = {
    typedName: name,
    accountId: account.id,
    accountName: account.name,
    signedAt: now,
    consentVersion: "invoice-signature-v1",
  };
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ invoice: documentContent(invoice), signature: metadata })).digest("hex");
  return { ...invoice, electronicSignature: { ...metadata, documentHash } };
}

// Evidence is independent of signing order. Retain the original account hash
// algorithm for invoices without supplier evidence; never rehash saved records.
function documentContent(invoice: Invoice) {
  const { electronicSignature: _account, supplierSignature: _supplier, ...document } = invoice;
  return document;
}

export function attachSupplierSignature(
  invoice: Invoice,
  typedName: string,
  account: Account,
  now = new Date(),
): Invoice {
  if (invoice.supplierSignature) throw new Error("Supplier signature already recorded");
  const name = typedName.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Invalid signature name");
  const metadata = {
    typedName: name,
    supplierName: invoice.supplierName,
    recordingAccountId: account.id,
    recordingAccountName: account.name,
    recordedAt: now,
    consentVersion: "invoice-supplier-signature-v1",
  };
  const documentHash = createHash("sha256")
    .update(JSON.stringify({ invoice: documentContent(invoice), supplierSignature: metadata })).digest("hex");
  return { ...invoice, supplierSignature: { ...metadata, documentHash } };
}
