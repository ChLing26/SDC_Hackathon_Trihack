import { RotateCw } from "lucide-react";
import { useGetProcurementRecommendations } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHead, ErrorBox, Empty } from "@/components/shell";

export default function Recommendations() {
  const q = useGetProcurementRecommendations();
  const d = q.data;
  const max = Math.max(1, ...(d?.recommendations.map((r) => r.approvals) ?? []));
  return (
    <>
      <PageHead kicker="Insights" title="What past choices suggest">
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh"><RotateCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </PageHead>
      {q.isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> :
        q.isError || !d ? <ErrorBox onRetry={() => q.refetch()} /> : (
        <>
          <div className="rise rounded-md border-l-4 border-accent bg-card p-6 mb-8">
            <p className="text-lg leading-relaxed" data-testid="text-summary">{d.summary}</p>
            <p className="num text-[11px] text-muted-foreground mt-3">Based on {d.historyCount} past decisions · generated {new Date(d.generatedAt).toLocaleString()} · AI-assisted, verify before acting</p>
          </div>
          {!d.recommendations.length ? <Empty title="Not enough history" body="Approve a few requests and supplier patterns will show up here." /> :
            <ol className="space-y-2">
              {d.recommendations.map((r, i) => (
                <li key={r.supplierName} className="rise grid grid-cols-[32px_1fr] md:grid-cols-[32px_220px_1fr] gap-x-4 gap-y-2 items-start rounded-md border bg-card p-4" style={{ animationDelay: `${i * 60}ms` }} data-testid={`row-recommendation-${i}`}>
                  <span className="num text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="font-semibold">{r.supplierName}</div>
                    <div className="flex items-center gap-2 mt-1.5"><div className="h-1.5 flex-1 rounded bg-muted overflow-hidden"><div className="h-full bg-accent origin-left" style={{ transform: `scaleX(${r.approvals / max})` }} /></div><span className="num text-xs">{r.approvals} approved</span></div>
                  </div>
                  <p className="col-span-2 md:col-span-1 text-sm text-muted-foreground">{r.reason}</p>
                </li>
              ))}
            </ol>}
        </>
      )}
    </>
  );
}
