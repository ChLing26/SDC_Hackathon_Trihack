import { createHash } from "node:crypto";
import { db, procurementRecords } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetProcurementRequestResponse, CreateProcurementRequestBody } from "@workspace/api-zod";

const vendors = [
  { name: "Nusa Supply Co.", location: "Shah Alam", distance: 24, factor: .79, shipping: 45, days: 2, reliability: 4.9 },
  { name: "Metro Business Supplies", location: "Kuala Lumpur", distance: 8, factor: .87, shipping: 20, days: 1, reliability: 4.7 },
  { name: "Northern Trade Partners", location: "Penang", distance: 350, factor: .72, shipping: 120, days: 4, reliability: 4.6 },
  { name: "Southern Industrial", location: "Johor Bahru", distance: 330, factor: .83, shipping: 95, days: 3, reliability: 4.8 },
];
export const round = (value: number) => Math.round(value * 100) / 100;
export async function listRecords() {
  const rows = await db.select().from(procurementRecords).orderBy(procurementRecords.createdAt);
  return rows.map(row => GetProcurementRequestResponse.parse(row.data)).reverse();
}
export async function createRecord(raw: unknown) {
  const input = CreateProcurementRequestBody.parse(raw);
  return db.transaction(async tx => {
  const [row] = await tx.insert(procurementRecords).values({ data: {} }).returning();
  const offers = vendors.map((vendor, index) => {
    const unitPrice = round(input.budgetAmount * vendor.factor / input.quantity);
    const shippingFee = round(Math.min(vendor.shipping, input.budgetAmount * .05));
    const totalPrice = round(unitPrice * input.quantity + shippingFee);
    const priceScore = round(Math.max(0, Math.min(100, (1 - totalPrice / input.budgetAmount) * 200 + 50)));
    const availableDays = Math.max(0, Math.ceil((new Date(input.requiredDeliveryDate).getTime() - Date.now()) / 86400000));
    const speedScore = Math.max(0, 100 - vendor.days * 8 - Math.max(0, vendor.days - availableDays) * 20);
    const proximityScore = round(Math.max(0, 100 - vendor.distance / 5));
    const reliabilityScore = vendor.reliability * 20;
    return { id: row!.id * 100 + index + 1, supplierName: vendor.name, supplierLocation: vendor.location, distanceKm: vendor.distance,
      unitPrice, shippingFee, totalPrice, currency: input.currency.toUpperCase(), deliveryDays: vendor.days, reliability: vendor.reliability,
      priceScore, speedScore, proximityScore, reliabilityScore, overallScore: round((priceScore + speedScore + proximityScore + reliabilityScore) / 4), rank: 0 };
  }).sort((a,b) => b.overallScore - a.overallScore).map((offer,index) => ({ ...offer, rank: index + 1 }));
  const record = { ...input, currency: input.currency.toUpperCase(), id: row!.id, status: "pending_approval", offerCount: offers.length,
    offers, selectedSupplier: null, selectedOfferId: null, managerName: null, managerComment: null, invoice: null, createdAt: new Date().toISOString() };
  const parsed = GetProcurementRequestResponse.parse(record);
  await tx.update(procurementRecords).set({ data: parsed }).where(eq(procurementRecords.id, row!.id));
  return parsed;
  });
}
export function makeInvoice(record: Awaited<ReturnType<typeof listRecords>>[number], offerId: number, managerName: string) {
  const offer = record.offers.find(o => o.id === offerId)!;
  const invoice = { id: record.id, reference: `INV-${new Date().getFullYear()}-${String(record.id).padStart(4,"0")}`, requestId: record.id,
    itemName: record.itemName, quantity: record.quantity, supplierName: offer.supplierName, buyerName: record.requesterName,
    unitPrice: offer.unitPrice, shippingFee: offer.shippingFee, totalAmount: offer.totalPrice, currency: record.currency,
    issuedAt: new Date().toISOString(), signatureType: "SHA-256 integrity record (not a certified signature)" };
  return { ...invoice, signature: createHash("sha256").update(JSON.stringify({ ...invoice, approvedBy: managerName })).digest("hex") };
}
