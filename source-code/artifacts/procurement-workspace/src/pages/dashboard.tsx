import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownRight, ArrowRight, Check, Clock3, FileText, Plus, Search, ShoppingBag, Sparkles, XCircle } from "lucide-react";
import { useGetProcurementDashboard } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHead, ErrorBox, Empty, money } from "@/components/shell";

const activityFilters = [
  { label: "Everything", value: "all" },
  { label: "Open quotes", value: "open_for_quotes" },
  { label: "Awaiting approval", value: "pending_approval" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export default function Dashboard() {
  const q = useGetProcurementDashboard();
  const d = q.data;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const visibleActivity = useMemo(() => (d?.recentActivity ?? [])
    .filter((activity) => filter === "all" || activity.kind === filter)
    .filter((activity) => !search || `${activity.title} ${activity.detail} ${activity.id}`.toLowerCase().includes(search.trim().toLowerCase())),
  [d?.recentActivity, filter, search]);

  const glanceStats = d ? [
    { label: "Active requests", value: d.activeRequests, icon: ShoppingBag, id: "active" },
    { label: "Awaiting approval", value: d.awaitingApproval, icon: Clock3, id: "awaiting", warn: d.awaitingApproval > 0 },
    { label: "Approved this month", value: d.approvedThisMonth, icon: Check, id: "approved" },
  ] : [];

  return (
    <>
      <PageHead kicker="Overview" title="Activities" description="A quick view of current requests, decisions, and budget savings.">
        <Link href="/requests?new=1" data-testid="link-new-request" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-px active:translate-y-0">
          <Plus className="h-4 w-4" /> New requirement <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </PageHead>
      {q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
          <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="Recent procurement activity">
            <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Recent activity</h2>
                <p className="mt-1 text-xs text-muted-foreground">Latest changes across requests and approvals</p>
              </div>
              <label className="flex h-9 w-full items-center gap-2 rounded-md border bg-background/70 px-3 text-muted-foreground sm:max-w-[230px]">
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search recent activity"
                  aria-label="Search recent activity"
                  data-testid="input-search-activity"
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/25 px-3 py-2" aria-label="Filter recent activity">
              {activityFilters.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  data-testid={`button-filter-activity-${item.value}`}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${filter === item.value ? "bg-secondary text-secondary-foreground font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {item.label}
                </button>
              ))}
              <span className="num ml-auto hidden shrink-0 px-2 text-[9px] uppercase tracking-wider text-muted-foreground sm:inline" data-testid="text-activity-count">
                {q.isLoading ? "Loading" : `${visibleActivity.length} entries`}
              </span>
            </div>

            <div className="hidden grid-cols-[minmax(0,1fr)_82px_140px] gap-3 bg-muted/35 px-5 py-2.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground md:grid">
              <span>Activity</span><span>Request</span><span>Updated</span>
            </div>

            {q.isLoading ? (
              <div className="space-y-3 p-5">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[58px] w-full" />)}</div>
            ) : visibleActivity.length ? (
              <div className="divide-y divide-border/70">
                {visibleActivity.map((activity, index) => {
                  const Icon = activity.kind === "approved" ? Check
                    : activity.kind === "rejected" ? XCircle
                    : activity.kind === "pending_approval" ? Clock3
                    : activity.kind === "open_for_quotes" ? ShoppingBag
                    : FileText;
                  const iconStyle = activity.kind === "approved" ? "bg-primary/10 text-primary"
                    : activity.kind === "rejected" ? "bg-destructive/10 text-destructive"
                    : activity.kind === "pending_approval" ? "bg-accent/15 text-accent"
                    : "bg-secondary text-secondary-foreground";

                  return (
                    <Link
                      href={`/requests/${activity.id}`}
                      key={activity.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/25 sm:px-5 md:grid-cols-[minmax(0,1fr)_82px_140px] md:gap-3"
                      style={{ animationDelay: `${index * 35}ms` }}
                      data-testid={`row-activity-${activity.id}`}
                      aria-label={`${activity.title}: ${activity.detail}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${iconStyle}`} aria-hidden>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">{activity.title}</span>
                          <span className="mt-1 block truncate text-[10px] text-muted-foreground">{activity.detail}</span>
                        </span>
                      </span>
                      <span className="num text-[10px] text-muted-foreground">#{activity.id}</span>
                      <time className="num col-start-2 row-start-2 text-right text-[9px] text-muted-foreground md:col-start-auto md:row-start-auto md:text-left" dateTime={activity.time}>
                        {new Date(activity.time).toLocaleString()}
                      </time>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 sm:p-5">
                <Empty
                  title={d?.recentActivity.length ? "No activity found" : "No activity recorded yet"}
                  body={d?.recentActivity.length ? "Try another search or activity filter." : "Create a requirement to start the trail of quotes and decisions."}
                />
              </div>
            )}
          </section>

          <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <section className="relative overflow-hidden rounded-xl border border-primary/10 bg-secondary/65 p-5 shadow-sm" data-testid="panel-budget-impact">
              <div className="absolute -right-8 -top-9 h-28 w-28 rounded-full border border-primary/10 shadow-[0_0_0_12px_hsl(var(--primary)/0.03),0_0_0_24px_hsl(var(--primary)/0.02)]" aria-hidden />
              <div className="relative">
                <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.13em] text-secondary-foreground/80">
                  <span>Budget impact</span><ArrowDownRight className="h-4 w-4" aria-hidden />
                </div>
                {q.isLoading ? <Skeleton className="mt-4 h-8 w-32" /> : (
                  <div className="num mt-4 text-2xl font-semibold tracking-tight" data-testid="text-stat-savings">{money(d?.savingsAgainstBudget ?? 0)}</div>
                )}
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">Saved against approved MYR request budgets.</p>
                <p className="mt-4 border-t border-primary/10 pt-3 text-[9px] text-muted-foreground">Only approved MYR requests are counted.</p>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="border-b px-4 py-3.5">
                <h2 className="text-xs font-bold">At a glance</h2>
              </div>
              {q.isLoading ? (
                <div className="space-y-3 p-4">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-6 w-full" />)}</div>
              ) : (
                <div className="divide-y divide-border/70">
                  {glanceStats.map(({ label, value, icon: Icon, id, warn }) => (
                    <div className="flex items-center justify-between gap-3 px-4 py-3" key={id} data-testid={`row-stat-${id}`}>
                      <span className="flex items-center gap-2 text-[10px] text-muted-foreground"><Icon className="h-3.5 w-3.5 text-primary/70" aria-hidden />{label}</span>
                      <strong className={`num text-sm font-medium ${warn ? "text-accent" : "text-foreground"}`} data-testid={`text-stat-${id}`}>{value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex gap-3 rounded-xl border border-accent/15 bg-accent/10 p-4 sm:col-span-2 xl:col-span-1" data-testid="panel-insights">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles className="h-4 w-4" aria-hidden /></span>
              <div>
                <h2 className="text-[11px] font-bold">Supplier insights</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">See recommendations based on your team’s approved supplier choices.</p>
                <Link href="/recommendations" className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline" data-testid="link-supplier-insights">
                  View supplier insights <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </div>
            </section>
            <p className="flex items-center gap-1.5 px-1 text-[9px] text-muted-foreground sm:col-span-2 xl:col-span-1">
              <Clock3 className="h-3 w-3" aria-hidden /> Activity refreshes automatically
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
