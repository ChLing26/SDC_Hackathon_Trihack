import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, X, MapPin, Truck, Receipt } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProcurementRequest, useDecideProcurementRequest,
  getGetProcurementRequestQueryKey, getListProcurementRequestsQueryKey, getGetProcurementDashboardQueryKey,
  getListProcurementInvoicesQueryKey, getGetProcurementRecommendationsQueryKey,
  type ProcurementOffer,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorBox, Empty, StatusTag, money, fdate } from "@/components/shell";
import { cn } from "@/lib/utils";
import { RequestAdvice } from "@/components/request-advice";

type SortKey = "score" | "price" | "distance";
const SUBS: [keyof ProcurementOffer, string][] = [["priceScore", "Price"], ["speedScore", "Speed"], ["proximityScore", "Proximity"], ["reliabilityScore", "Reliability"]];
const avg = (o: ProcurementOffer) => (o.priceScore + o.speedScore + o.proximityScore + o.reliabilityScore) / 4;
const pct = (n: number) => (n <= 1 ? n * 100 : n);

function Bar({ v, label }: { v: number; label: string }) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{label}</span><span className="num">{v.toFixed(1)}</span></div>
      <div className="h-1 rounded bg-muted mt-1 overflow-hidden"><div className="h-full bg-primary/70 origin-left transition-transform duration-700" style={{ transform: `scaleX(${Math.min(pct(v), 100) / 100})` }} /></div>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetProcurementRequest(requestId, { query: { enabled: !!requestId, queryKey: getGetProcurementRequestQueryKey(requestId) } });
  const decide = useDecideProcurementRequest();
  const [sort, setSort] = useState<SortKey>("score");
  const [picked, setPicked] = useState<number | null>(null);
  const [manager, setManager] = useState("");
  const [comment, setComment] = useState("");
  const [confirm, setConfirm] = useState<"approved" | "rejected" | null>(null);

  const r = q.data;
  const offers = useMemo(() => {
    const o = [...(r?.offers ?? [])];
    if (sort === "price") o.sort((a, b) => a.totalPrice - b.totalPrice);
    else if (sort === "distance") o.sort((a, b) => a.distanceKm - b.distanceKm);
    else o.sort((a, b) => a.rank - b.rank);
    return o;
  }, [r?.offers, sort]);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (q.isError || !r) return <ErrorBox onRetry={() => q.refetch()} msg="This request could not be loaded. It may not exist." />;

  const decided = r.status === "approved" || r.status === "rejected";
  const selectedId = decided ? r.selectedOfferId : picked ?? offers.find((o) => o.rank === 1)?.id ?? null;
  const sel = r.offers.find((o) => o.id === selectedId);

  const run = () => {
    if (!confirm) return;
    decide.mutate({ requestId, data: { decision: confirm, offerId: confirm === "approved" ? selectedId : selectedId ?? null, managerName: manager.trim(), comment: comment.trim() || undefined } }, {
      onSuccess: (res) => {
        qc.setQueryData(getGetProcurementRequestQueryKey(requestId), res);
        [getListProcurementRequestsQueryKey(), getGetProcurementDashboardQueryKey(), getListProcurementInvoicesQueryKey(), getGetProcurementRecommendationsQueryKey(), getGetProcurementRequestQueryKey(requestId)]
          .forEach((k) => qc.invalidateQueries({ queryKey: k }));
        toast({ title: confirm === "approved" ? "Approved, invoice record created" : "Request rejected" });
        setConfirm(null);
      },
      onError: () => { toast({ title: "Decision failed", variant: "destructive" }); setConfirm(null); },
    });
  };

  return (
    <>
      <Link href="/requests" className="no-print inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4" data-testid="link-back"><ArrowLeft className="h-4 w-4" /> Requests</Link>
      <div className="rise border-b pb-5 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-2"><span className="num text-xs text-muted-foreground">#{String(r.id).padStart(4, "0")}</span><StatusTag s={r.status} /></div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight" data-testid="text-item-name">{r.itemName}</h1>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          {[["Quantity", String(r.quantity)], ["Budget", money(r.budgetAmount, r.currency)], ["Needed by", fdate(r.requiredDeliveryDate)], ["Deliver to", r.deliveryLocation], ["Requester", r.requesterName]].map(([k, v]) => (
            <div key={k}><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="num font-medium mt-0.5 truncate">{v}</dd></div>
          ))}
        </dl>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold">Supplier offers <span className="num text-muted-foreground text-sm">({offers.length})</span></h2>
            <div className="flex rounded-md border bg-card p-1 text-xs">
              {(["score", "price", "distance"] as SortKey[]).map((k) => (
                <button key={k} onClick={() => setSort(k)} data-testid={`button-sort-${k}`} className={cn("rounded px-3 py-1 capitalize transition-colors", sort === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{k}</button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Overall score shown is the arithmetic average of the four sub-scores. Quotes are illustrative demo data.</p>
          {!offers.length ? <Empty title="No offers" body="No supplier quotes were generated for this request." /> :
            <div className="space-y-2">
              {offers.map((o, i) => {
                const active = o.id === selectedId;
                const overBudget = o.totalPrice > r.budgetAmount;
                return (
                  <button key={o.id} disabled={decided} onClick={() => setPicked(o.id)} data-testid={`card-offer-${o.id}`}
                    className={cn("rise w-full text-left rounded-md border bg-card p-4 transition-all", !decided && "hover:border-primary/50 hover:-translate-y-px", active && "border-primary ring-1 ring-primary", decided && !active && "opacity-60")}
                    style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className={cn("num grid h-8 w-8 shrink-0 place-items-center rounded text-sm font-semibold", o.rank === 1 ? "bg-accent text-accent-foreground" : "bg-muted")}>{o.rank}</div>
                      <div className="flex-1 min-w-[160px]">
                        <div className="font-semibold">{o.supplierName}</div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{o.supplierLocation} · <span className="num">{o.distanceKm} km</span></span>
                          <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" /><span className="num">{o.deliveryDays} d</span></span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("num font-semibold", overBudget && "text-destructive")}>{money(o.totalPrice, o.currency)}</div>
                        <div className="num text-[11px] text-muted-foreground">{money(o.unitPrice, o.currency)} /u + {money(o.shippingFee, o.currency)} ship</div>
                      </div>
                      <div className="text-right pl-3 border-l">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg</div>
                        <div className="num text-xl font-bold text-primary" data-testid={`text-score-${o.id}`}>{avg(o).toFixed(1)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">{SUBS.map(([k, l]) => <Bar key={k} v={o[k] as number} label={l} />)}</div>
                  </button>
                );
              })}
            </div>}
          <RequestAdvice requestId={r.id} currency={r.currency}
            key={JSON.stringify([r.id, r.quantity, r.budgetAmount, r.currency, r.requiredDeliveryDate, r.offers])} />
        </section>

        <aside className="lg:sticky lg:top-6 self-start rounded-md border bg-card p-5">
          <h2 className="font-semibold mb-1">Manager review</h2>
          {decided ? (
            <div className="space-y-3 text-sm" data-testid="panel-decision">
              <StatusTag s={r.status} />
              {sel && <div><div className="text-xs text-muted-foreground">Supplier</div><div className="font-medium">{sel.supplierName}</div></div>}
              <div><div className="text-xs text-muted-foreground">Decided by (self-entered)</div><div className="font-medium">{r.managerName ?? "Unknown"}</div></div>
              {r.managerComment && <blockquote className="border-l-2 border-accent pl-3 italic text-muted-foreground">{r.managerComment}</blockquote>}
              {r.invoice && <Link href="/invoices" className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline" data-testid="link-invoice"><Receipt className="h-4 w-4" />Invoice {r.invoice.reference}</Link>}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Selected offer: <span className="font-medium text-foreground">{sel?.supplierName ?? "none"}</span>{sel && <span className="num"> · {money(sel.totalPrice, sel.currency)}</span>}</p>
              <div><label className="text-xs">Manager name</label><Input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Self-entered, not verified" data-testid="input-manager" /></div>
              <div><label className="text-xs">Comment</label><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Why this choice?" data-testid="input-comment" /></div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="text-destructive" disabled={manager.trim().length < 2} onClick={() => setConfirm("rejected")} data-testid="button-reject"><X className="h-4 w-4 mr-1" />Reject</Button>
                <Button disabled={manager.trim().length < 2 || !selectedId} onClick={() => setConfirm("approved")} data-testid="button-approve"><Check className="h-4 w-4 mr-1" />Approve</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Approval creates an internal invoice record automatically.</p>
            </div>
          )}
        </aside>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "approved" ? `Approve ${sel?.supplierName ?? ""}?` : "Reject this request?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "approved" ? `Records ${manager} as approver and issues an internal invoice record for ${sel ? money(sel.totalPrice, sel.currency) : ""}.` : `Records ${manager} as the reviewer who rejected this request.`} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); run(); }} disabled={decide.isPending} data-testid="button-confirm-decision"
              className={confirm === "rejected" ? "bg-destructive text-destructive-foreground" : ""}>{decide.isPending ? "Recording..." : "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
