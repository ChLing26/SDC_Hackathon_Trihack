import { z } from "zod/v4";
import {
  GetProcurementAdviceResponse,
  type ProcurementAdvice,
  type ProcurementAdviceInput,
  type ProcurementRequestDetail,
} from "@workspace/api-zod";

// Never accept a destination or credential from the browser. Do not follow redirects.
const DESTINATION = "http://127.0.0.1:8000/supplier-advice";
const MAX_MONEY = 1_000_000_000_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const money = z.number().finite().min(0).max(MAX_MONEY);
const nonnegative = z.number().finite().min(0);
const warningSchema = z.object({
  quote_id: z.string().max(128),
  supplier: z.string().max(200),
  type: z.enum(["TOTAL_COST_MISMATCH", "INVALID_ROUTE", "UNUSUALLY_HIGH_PRICE", "UNUSUALLY_HIGH_SHIPPING"]),
  severity: z.enum(["high", "medium"]),
  message: z.string().max(2000),
});
const responseSchema = z.object({
  status: z.literal("success"),
  supplier_count: z.number().int().min(1).max(100),
  warning_count: z.number().int().min(0).max(400),
  ai_status: z.enum(["success", "unavailable", "failed", "skipped"]),
  ai_advice: z.string().max(20000).nullable(),
  warnings: z.array(warningSchema).max(400),
  suppliers: z.array(z.object({
    quote_id: z.string().max(128),
    name: z.string().max(200),
    product_price_rm: money,
    shipping_rm: money,
    total_cost_rm: money,
    reported_total_cost_rm: money.nullable(),
    delivery_days: nonnegative,
    distance_km: nonnegative,
    route_status: z.literal("OK"),
    within_budget: z.boolean(),
    meets_delivery_requirement: z.boolean(),
    anomalies: z.array(warningSchema).max(4),
  })).min(1).max(100),
});
const storedOffer = z.object({
  id: z.number().int().positive().safe(),
  supplierName: z.string().trim().min(1).max(200),
  unitPrice: money,
  shippingFee: money,
  totalPrice: money,
  currency: z.literal("MYR"),
  deliveryDays: z.number().int().min(0),
  distanceKm: nonnegative,
});
const storedInput = z.object({
  id: z.number().int().positive().safe(),
  quantity: z.number().int().min(1).max(1_000_000_000),
  budgetAmount: money,
  currency: z.literal("MYR"),
  requiredDeliveryDate: z.date(),
  offers: z.array(storedOffer).min(1).max(100),
});

export class AdviceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function cents(value: number) {
  const rounded = Math.round(value * 100);
  if (Math.abs(value * 100 - rounded) > 0.001) throw new Error("Invalid stored money precision");
  return rounded;
}

export function buildAdvicePayload(record: ProcurementRequestDetail, input: ProcurementAdviceInput, now = Date.now()) {
  try {
    const data = storedInput.parse(record);
    const storedDate = data.requiredDeliveryDate;
    const date = Date.UTC(storedDate.getUTCFullYear(), storedDate.getUTCMonth(), storedDate.getUTCDate());
    if (new Set(data.offers.map(o => o.id)).size !== data.offers.length) throw new Error("Duplicate offer");
    // Match the existing illustrative scoring policy, not a new shipping/ETA promise.
    const maxDays = Math.max(0, Math.ceil((date - now) / 86_400_000));
    const suppliers = data.offers.map(offer => {
      const subtotalCents = cents(offer.unitPrice) * data.quantity;
      const totalCents = subtotalCents + cents(offer.shippingFee);
      if (!Number.isSafeInteger(totalCents) || totalCents > MAX_MONEY * 100) throw new Error("Money overflow");
      cents(offer.totalPrice);
      return {
        quote_id: `request-${data.id}:offer-${offer.id}`,
        name: offer.supplierName,
        product_price_rm: subtotalCents / 100,
        shipping_rm: offer.shippingFee,
        total_cost_rm: offer.totalPrice, // Preserve reported total so Python can flag mismatches.
        delivery_days: offer.deliveryDays,
        distance_km: offer.distanceKm,
        // Stored offers are illustrative; this does NOT certify a live route.
        route_status: "OK" as const,
      };
    });
    return {
      payload: { suppliers, budget: data.budgetAmount, max_delivery_days: maxDays, priority: input.priority ?? "balanced" },
      deadlinePassed: date < now,
    };
  } catch {
    throw new AdviceError(422, "Advice requires valid MYR offers with cent-precision prices and a valid delivery date.");
  }
}

type Dependencies = { fetch?: typeof fetch; token?: () => string | undefined; timeoutMs?: number };

export function createPythonAdviceClient(dependencies: Dependencies = {}) {
  const transport = dependencies.fetch ?? fetch;
  const getToken = dependencies.token ?? (() => process.env.PYTHON_BACKEND_TOKEN);
  const timeoutMs = dependencies.timeoutMs ?? 20_000;
  return async (record: ProcurementRequestDetail, input: ProcurementAdviceInput, now = Date.now()): Promise<ProcurementAdvice> => {
    const { payload, deadlinePassed } = buildAdvicePayload(record, input, now);
    const token = getToken()?.trim();
    if (!token || token.length < 32) throw new AdviceError(503, "Private supplier advice is not configured.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AdviceError(504, "Supplier advice timed out. Please try again."));
      }, timeoutMs);
    });
    try {
      const raw = await Promise.race([timeout, (async () => {
        const response = await transport(DESTINATION, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AdviceError(503, "Private supplier advice is temporarily unavailable.");
        }
        if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
          throw new AdviceError(502, "Private supplier advice returned an invalid response.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "", size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new AdviceError(502, "Private supplier advice returned an invalid response.");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        try { return JSON.parse(text + decoder.decode()) as unknown; }
        catch { throw new AdviceError(502, "Private supplier advice returned an invalid response."); }
      })()]);
      let result: z.infer<typeof responseSchema>;
      try {
        result = responseSchema.parse(raw);
        if (result.supplier_count !== payload.suppliers.length || result.suppliers.length !== payload.suppliers.length ||
            result.warning_count !== result.warnings.length || new Set(result.suppliers.map(s => s.quote_id)).size !== result.suppliers.length ||
            (result.ai_status === "success" && !result.ai_advice?.trim())) throw new Error("Invalid counts");
        const expected = new Map(payload.suppliers.map(s => [s.quote_id, s]));
        for (const warning of result.warnings) {
          if (expected.get(warning.quote_id)?.name !== warning.supplier) throw new Error("Unknown warning identity");
        }
        for (const supplier of result.suppliers) {
          const sent = expected.get(supplier.quote_id);
          if (!sent || supplier.name !== sent.name || supplier.product_price_rm !== sent.product_price_rm ||
              supplier.shipping_rm !== sent.shipping_rm || supplier.reported_total_cost_rm !== sent.total_cost_rm ||
              supplier.delivery_days !== sent.delivery_days || supplier.distance_km !== sent.distance_km ||
              cents(supplier.total_cost_rm) !== cents(sent.product_price_rm) + cents(sent.shipping_rm) ||
              supplier.within_budget !== (supplier.total_cost_rm <= payload.budget) ||
              supplier.meets_delivery_requirement !== (supplier.delivery_days <= payload.max_delivery_days) ||
              JSON.stringify(supplier.anomalies) !== JSON.stringify(result.warnings.filter(w => w.quote_id === supplier.quote_id))) {
            throw new Error("Response does not match persisted offers");
          }
        }
      } catch {
        throw new AdviceError(502, "Private supplier advice returned an invalid response.");
      }
      const ids = new Map(record.offers.map(o => [`request-${record.id}:offer-${o.id}`, o.id]));
      const mapWarning = (w: z.infer<typeof warningSchema>) => ({
        offerId: ids.get(w.quote_id)!, type: w.type, severity: w.severity, message: w.message,
      });
      return GetProcurementAdviceResponse.parse({
        requestId: record.id, generatedAt: new Date(now).toISOString(), source: "illustrative_offers",
        maxDeliveryDays: payload.max_delivery_days, deadlinePassed, deadlinePolicy: "stored_date_utc_midnight",
        aiStatus: result.ai_status,
        advice: result.ai_status === "success" ? result.ai_advice :
          result.ai_status === "skipped" ? null : "AI advice is unavailable. Eligibility and anomaly checks are still available.",
        suppliers: result.suppliers.map(s => ({
          offerId: ids.get(s.quote_id)!, supplierName: s.name, productSubtotal: s.product_price_rm,
          shippingFee: s.shipping_rm, totalPrice: s.total_cost_rm, currency: "MYR",
          deliveryDays: s.delivery_days, distanceKm: s.distance_km, withinBudget: s.within_budget,
          meetsDeliveryRequirement: !deadlinePassed && s.meets_delivery_requirement,
          anomalies: s.anomalies.map(mapWarning),
        })),
        warnings: result.warnings.map(mapWarning),
      });
    } catch (error) {
      if (error instanceof AdviceError) throw error;
      if (controller.signal.aborted) throw new AdviceError(504, "Supplier advice timed out. Please try again.");
      // Never log or return provider bodies, credential-bearing requests, or raw exceptions.
      throw new AdviceError(503, "Private supplier advice is temporarily unavailable.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export const getPythonAdvice = createPythonAdviceClient();
