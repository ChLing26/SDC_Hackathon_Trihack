import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect, useSearch } from 'wouter';
import { Shell } from '@/components/shell';
import Dashboard from '@/pages/dashboard';
import Requests from '@/pages/requests';
import RequestDetail from '@/pages/request-detail';
import Approvals from '@/pages/approvals';
import Invoices from '@/pages/invoices';
import Recommendations from '@/pages/recommendations';
import AuthScreen from '@/pages/auth';
import { AuthProvider, safeReturnPath, useAuth } from '@/lib/auth';
import { SettingsProvider } from '@/lib/settings';
import Settings from '@/pages/settings';

const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: (count, error) => (error as { status?: number }).status !== 401 && count < 1,
  refetchOnWindowFocus: true, refetchInterval: 30000,
} } });

function SessionGate() {
  const { user, phase, retry } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  if (phase === "loading") return <div className="paper-grain grid min-h-[100dvh] place-items-center px-6" role="status">
    <div className="w-full max-w-sm rounded-2xl border bg-card p-7 text-center shadow-sm">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary font-bold">P</div>
      <p className="font-semibold">Opening your ledger</p>
      <p className="mt-1 text-sm text-muted-foreground">Checking your ProcureFlow session…</p>
      <div className="mt-6 space-y-2" aria-hidden><div className="h-2 rounded-full bg-muted" /><div className="mx-auto h-2 w-2/3 rounded-full bg-muted" /></div>
    </div>
  </div>;
  if (phase === "error") return <main className="paper-grain grid min-h-[100dvh] max-w-none place-items-center px-6 py-10">
    <section className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent/15 font-bold text-accent">P</div>
      <h1 className="text-3xl font-bold">A little pause</h1>
      <p role="alert" className="my-4 text-sm leading-relaxed text-muted-foreground">We couldn’t check your session. Check your connection and try again.</p>
      <button className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:-translate-y-px" onClick={retry}>Try again</button>
    </section>
  </main>;
  const entry = location === "/login" || location === "/signup";
  if (!user) {
    if (entry) return <AuthScreen key={location} />;
    const requested = safeReturnPath(`${location}${search ? `?${search}` : ""}`);
    return <Redirect to={`/login${requested === "/" ? "" : `?returnTo=${encodeURIComponent(requested)}`}`} replace />;
  }
  if (entry) return <Redirect to={safeReturnPath(new URLSearchParams(search).get("returnTo"))} replace />;
  return <Router />;
}

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/requests" component={Requests} />
          <Route path="/requests/:id" component={RequestDetail} />
          <Route path="/approvals" component={Approvals} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/recommendations" component={Recommendations} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => {
    const page = location === "/" ? "Buying activity" : location.startsWith("/requests/") ? "Compare supplier offers" : ({ "/requests": "Procurement requests", "/approvals": "Manager approvals", "/invoices": "Invoice records", "/recommendations": "Supplier insights", "/settings": "Settings" }[location] ?? "Workspace");
    document.title = `${page} · ProcureFlow`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", `${page}: manage SME purchasing requirements, compare supplier quotes, and keep clear approval records with ProcureFlow.`);
  }, [location]);
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider><SettingsProvider><SessionGate /></SettingsProvider></AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
