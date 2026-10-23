import { useGetProcurementAdvice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { money } from "@/components/shell";

const failureLabels = {
  configuration: "Gemini is not configured",
  quota: "Gemini quota limit",
  permission: "Gemini permission or credential issue",
  model: "Gemini model unavailable or invalid",
  timeout: "Gemini timed out",
  provider: "Gemini provider error",
} as const;

/** Transient checks only: never selects a supplier or changes a procurement record. */
export function RequestAdvice({ requestId, currency }: { requestId: number; currency: string }) {
  const mutation = useGetProcurementAdvice();
  const result = mutation.data;
  return (
    <section className="rounded-md border bg-card p-4 mt-5 space-y-3 no-print" aria-labelledby="advice-title" data-testid="request-advice">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="advice-title" className="font-semibold">Supplier checks &amp; AI advice</h2>
        <Button variant="outline" size="sm" disabled={mutation.isPending || currency !== "MYR"}
          onClick={() => mutation.mutate({ requestId, data: { priority: "balanced" } })}
          data-testid="button-supplier-advice">
          {mutation.isPending ? "Checking stored offers…" : result ? "Run checks again" : "Check stored offers"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Checks use illustrative stored offers, not live supplier quotes or verified routes. They do not change scores,
        approvals or invoices. Results are temporary; run checks again after returning to this page.
      </p>
      {currency !== "MYR" && <p className="text-sm">Advice currently supports MYR only. No currency conversion is performed.</p>}
      {mutation.isPending && <p role="status" className="text-sm">Validating totals and eligibility, then requesting optional Gemini advice…</p>}
      {mutation.isError && <p role="alert" className="text-sm text-destructive">
        Supplier checks could not be completed. Your procurement data has not changed. Please try again.
      </p>}
      {result && !mutation.isPending && !mutation.isError && (
        <div className="space-y-3 text-sm" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            Checked {new Date(result.generatedAt).toLocaleString()} · AI status: {result.aiStatus}.
            Delivery checks use {result.maxDeliveryDays} remaining 24-hour periods to UTC midnight of the stored delivery date,
            matching the existing illustrative scoring policy.
          </p>
          {result.aiFailure && <p role="status" data-testid="gemini-failure-category" className="text-xs text-muted-foreground">
            {failureLabels[result.aiFailure.category]}
            {result.aiFailure.httpStatus === null ? "" : ` · HTTP ${result.aiFailure.httpStatus}`}.
            Deterministic eligibility and anomaly checks are still available.
          </p>}
          {result.deadlinePassed && <p role="alert" className="text-destructive">The stored delivery deadline has passed. No offer meets that deadline.</p>}
          <ul className="divide-y">
            {result.suppliers.map(s => (
              <li key={s.offerId} className="py-2 space-y-1" data-testid={`advice-offer-${s.offerId}`}>
                <div className="font-medium">{s.supplierName}</div>
                <div className="num text-xs text-muted-foreground">
                  Products {money(s.productSubtotal, s.currency)} + shipping {money(s.shippingFee, s.currency)} = {money(s.totalPrice, s.currency)}
                </div>
                <div className="text-xs">
                  {s.withinBudget ? "Within budget" : "Over budget"} · {s.meetsDeliveryRequirement ? "Meets delivery estimate" : "Misses delivery requirement"}
                </div>
                {s.anomalies.map((w, i) => <p key={`${w.type}-${i}`} className="text-xs text-destructive">
                  {w.severity === "high" ? "High warning" : "Warning"}: {w.message}
                </p>)}
              </li>
            ))}
          </ul>
          {result.warnings.length === 0 && <p className="text-xs text-muted-foreground">No anomalies detected in these illustrative offers. This is not a verification of supplier performance.</p>}
          <div className="rounded bg-muted/60 p-3 whitespace-pre-wrap" data-testid="text-supplier-advice">
            {result.advice ?? "No AI advice was generated. Eligibility checks remain available."}
          </div>
          <p className="text-xs text-muted-foreground">AI advice is informational only. Manager review remains a separate action.</p>
        </div>
      )}
    </section>
  );
}
