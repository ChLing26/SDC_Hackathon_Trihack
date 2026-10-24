/**
 * Manual, explicitly approved probe. Never included in normal test discovery.
 * Uses the real adapter and running private service, but no DB or app routes.
 * Build with esbuild; run only with RUN_LIVE_GEMINI_TEST=1 after approval.
 */
import assert from "node:assert/strict";
import { GetProcurementRequestResponse } from "@workspace/api-zod";
import { createPythonAdviceClient } from "../lib/python-advice";

async function main() {
  if (process.env.RUN_LIVE_GEMINI_TEST !== "1") {
    console.log("BLOCKED: explicit approval and RUN_LIVE_GEMINI_TEST=1 are required.");
    process.exitCode = 77;
    return;
  }
  const now = Date.UTC(2026, 9, 23);
  const record = GetProcurementRequestResponse.parse({
    id: 900001, itemName: "Synthetic connectivity fixture", quantity: 1,
    budgetAmount: 30, currency: "MYR", requiredDeliveryDate: "2026-10-26",
    deliveryLocation: "Synthetic city", requesterName: "Synthetic buyer",
    status: "pending_approval", offerCount: 2, selectedSupplier: null,
    createdAt: "2026-10-23T00:00:00Z", selectedOfferId: null,
    managerName: null, managerComment: null, invoice: null,
    offers: [
      { id: 900011, supplierName: "Synthetic Alpha", unitPrice: 20, shippingFee: 5,
        totalPrice: 25, deliveryDays: 2, distanceKm: 4 },
      { id: 900012, supplierName: "Synthetic Beta", unitPrice: 35, shippingFee: 5,
        totalPrice: 40, deliveryDays: 5, distanceKm: 10 },
    ].map(offer => ({
      ...offer, supplierLocation: "Synthetic city", currency: "MYR",
      reliability: 4, overallScore: 50, priceScore: 50, speedScore: 50,
      proximityScore: 50, reliabilityScore: 50, rank: 1,
    })),
  });
  try {
    // Exactly one adapter invocation, no retries or database imports.
    const result = await createPythonAdviceClient()(record, { priority: "lowest_cost" }, now);
    assert.equal(result.suppliers[0].totalPrice, 25);
    assert.equal(result.suppliers[0].withinBudget, true);
    assert.equal(result.suppliers[0].meetsDeliveryRequirement, true);
    assert.equal(result.suppliers[1].withinBudget, false);
    assert.equal(result.suppliers[1].meetsDeliveryRequirement, false);
    if (result.aiStatus !== "success") {
      console.log(`FAIL: private service and adapter returned aiStatus=${result.aiStatus}; live model access is NOT verified.`);
      process.exitCode = 1;
      return;
    }
    assert.ok(result.advice?.trim());
    // Check that advice refers to the eligible synthetic quote without printing it.
    assert.match(result.advice!, /Synthetic Alpha|request-900001:offer-900011/i);
    console.log("PASS: live advice received through private Python HTTP and the real Express adapter; synthetic eligibility and recommendation identity checked.");
  } catch {
    // Do not print response bodies, tokens, request options, or raw exceptions.
    console.log("FAIL: live advice probe failed; details suppressed. Do not retry without approval.");
    process.exitCode = 1;
  }
}

await main();
