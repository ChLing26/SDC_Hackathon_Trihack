import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useListProcurementRequests } from "@workspace/api-client-react";
import { PageHead, ErrorBox, Empty, Rows, money, fdate } from "@/components/shell";

export default function Approvals() {
  const q = useListProcurementRequests();
  const items = (q.data ?? []).filter((r) => r.status === "pending_approval").sort((a, b) => +new Date(a.requiredDeliveryDate) - +new Date(b.requiredDeliveryDate));
  return (
    <>
      <PageHead kicker="Queue" title="Pending Reviews"><span className="num text-sm text-muted-foreground">{items.length} waiting · soonest deadline first</span></PageHead>
      {q.isLoading ? <Rows n={4} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> :
        !items.length ? <Empty title="Queue is clear" body="No requests are waiting for a manager decision." /> :
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((r, i) => {
            const days = Math.ceil((+new Date(r.requiredDeliveryDate) - Date.now()) / 864e5);
            return (
              <Link key={r.id} href={`/requests/${r.id}`} data-testid={`card-approval-${r.id}`} style={{ animationDelay: `${i * 50}ms` }}
                className="rise group rounded-md border bg-card p-5 hover:border-accent/60 transition-colors">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0"><div className="font-semibold truncate">{r.itemName}</div><div className="text-xs text-muted-foreground">{r.requesterName} · {r.deliveryLocation}</div></div>
                  <span className={`num shrink-0 rounded px-2 py-0.5 text-[11px] ${days <= 7 ? "bg-accent/15 text-accent" : "bg-muted"}`}>{days < 0 ? "overdue" : `${days}d left`}</span>
                </div>
                <div className="mt-4 flex items-end justify-between text-sm">
                  <div className="num"><div>{money(r.budgetAmount, r.currency)}</div><div className="text-xs text-muted-foreground">{r.quantity} units · {r.offerCount} quotes · by {fdate(r.requiredDeliveryDate)}</div></div>
                  <span className="inline-flex items-center gap-1 text-primary font-medium">Review <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                </div>
              </Link>
            );
          })}
        </div>}
    </>
  );
}
