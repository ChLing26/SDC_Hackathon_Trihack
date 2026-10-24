import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Eye, EyeOff, Loader2, AlertTriangle, Info, ArrowRight } from "lucide-react";
import type { AccountCredentials, AccountRegistration } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { StationeryDecor } from "@/components/stationery-decor";

type Field = "name" | "email" | "password" | "passwordConfirmation";
type Errors = Partial<Record<Field, string>>;

const TEMP = "We couldn't reach ProcureFlow just now. Check your connection and try again.";
const FIELDS: Field[] = ["name", "email", "password", "passwordConfirmation"];

function readError(err: unknown): { form: string; fields: Errors } {
  const e = err as { name?: string; status?: number; data?: unknown } | null;
  if (e && e.name === "ApiError" && typeof e.status === "number") {
    if (e.status >= 500) return { form: TEMP, fields: {} };
    const d = e.data as { error?: unknown; fields?: unknown } | null;
    const fields: Errors = {};
    if (d && d.fields && typeof d.fields === "object") {
      for (const [k, v] of Object.entries(d.fields as Record<string, unknown>)) {
        if ((FIELDS as string[]).includes(k) && typeof v === "string") fields[k as Field] = v.slice(0, 200);
      }
    }
    const form = d && typeof d.error === "string" ? d.error.slice(0, 200) : e.status === 429 ? "Too many attempts. Wait a moment and try again." : TEMP;
    return { form, fields };
  }
  return { form: TEMP, fields: {} };
}

export default function AuthScreen() {
  const [loc] = useLocation();
  const search = useSearch();
  const isSignup = loc.startsWith("/signup");
  const { login, register } = useAuth();
  const returnTo = new URLSearchParams(search).get("returnTo");
  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  const [v, setV] = useState({ name: "", email: "", password: "", passwordConfirmation: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setErrors({}); setFormError(null); setShow(false);
    document.title = `${isSignup ? "Create account" : "Sign in"} · ProcureFlow`;
  }, [isSignup]);

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((p) => ({ ...p, [k]: e.target.value }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
    if (formError) setFormError(null);
  };

  const validate = (): Errors => {
    const x: Errors = {};
    if (isSignup) {
      if (!v.name.trim()) x.name = "Enter your name.";
      else if (v.name.trim().length > 100) x.name = "Name must be 100 characters or fewer.";
    }
    if (!v.email.trim()) x.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) || v.email.length > 254) x.email = "Enter a valid email address.";
    if (!v.password) x.password = "Enter your password.";
    else if (v.password.length > 128) x.password = "Password must be 128 characters or fewer.";
    else if (isSignup && v.password.length < 12) x.password = "Use at least 12 characters.";
    if (isSignup) {
      if (!v.passwordConfirmation) x.passwordConfirmation = "Confirm your password.";
      else if (v.passwordConfirmation !== v.password) x.passwordConfirmation = "Passwords do not match.";
    }
    return x;
  };

  const focusFirst = (x: Errors) => {
    const f = FIELDS.find((k) => x[k]);
    if (f) document.getElementById(`auth-${f}`)?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const x = validate();
    setErrors(x); setFormError(null);
    if (Object.keys(x).length) { focusFirst(x); return; }
    setPending(true);
    try {
      if (isSignup) {
        const data: AccountRegistration = { name: v.name.trim(), email: v.email.trim(), password: v.password, passwordConfirmation: v.passwordConfirmation };
        await register(data);
      } else {
        const data: AccountCredentials = { email: v.email.trim(), password: v.password };
        await login(data);
      }
    } catch (err) {
      const r = readError(err);
      setErrors(r.fields); setFormError(r.form);
      setTimeout(() => (Object.keys(r.fields).length ? focusFirst(r.fields) : alertRef.current?.focus()), 0);
    } finally {
      setPending(false);
    }
  };

  const input = (k: Field, label: string, type: string, auto: string, hint?: string) => {
    const err = errors[k];
    const isPw = k === "password" || k === "passwordConfirmation";
    return (
      <div>
        <label htmlFor={`auth-${k}`} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-foreground/80">{label}</label>
        <div className="relative">
          <input id={`auth-${k}`} name={k} type={isPw ? (show ? "text" : "password") : type} autoComplete={auto} value={v[k]} onChange={set(k)} disabled={pending}
            aria-invalid={!!err} aria-describedby={[err && `auth-${k}-err`, hint && `auth-${k}-hint`].filter(Boolean).join(" ") || undefined}
            data-testid={`input-${k}`}
            className={cn("w-full rounded-md border bg-card px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60",
              isPw && k === "password" && "pr-11", err ? "border-destructive" : "border-input")} />
          {k === "password" && (
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} data-testid="button-toggle-password"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        {hint && !err && <p id={`auth-${k}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {err && <p id={`auth-${k}-err`} className="mt-1 text-xs font-medium text-destructive" data-testid={`error-${k}`}>{err}</p>}
      </div>
    );
  };

  return (
    <div className="paper-grain min-h-[100dvh] md:grid md:grid-cols-[1.05fr_1fr]">
      <StationeryDecor />
      <aside className="relative z-[1] hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground md:flex md:flex-col">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded bg-sidebar-primary font-bold text-sidebar-primary-foreground">P</div>
          <div>
            <div className="font-bold leading-none tracking-tight">SupplyMate</div>
            <div className="num mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/50">by trihack</div>
          </div>
        </div>
        <div className="my-auto max-w-md rise">
          <div className="num mb-4 text-[11px] uppercase tracking-[0.25em] text-sidebar-primary">Entry No. {isSignup ? "001" : "—"}</div>
          <h2 className="text-5xl font-extrabold leading-[1.02] tracking-tight">Every purchase,<br />on the record.</h2>
          <p className="mt-5 text-sm leading-relaxed text-sidebar-foreground/70">Raise requirements, compare supplier offers side by side, and keep a clean trail of who approved what.</p>
          <div className="mt-10 space-y-0 border-t border-sidebar-border">
            {[["Requests", "open for quotes"], ["Offers", "ranked on price, speed, distance"], ["Approvals", "logged with comment"]].map(([a, b], i) => (
              <div key={a} className="num flex items-baseline justify-between border-b border-sidebar-border py-3 text-xs">
                <span className="text-sidebar-foreground/40">0{i + 1}</span>
                <span className="flex-1 px-4 font-semibold uppercase tracking-wider">{a}</span>
                <span className="text-sidebar-foreground/60">{b}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-sidebar-foreground/50">Demo prototype. Supplier quotes are illustrative. Invoices are internal records, not tax-authority validated and not sent externally.</p>
      </aside>
      <main className="relative z-[1] flex min-h-[100dvh] flex-col px-5 py-8 md:justify-center md:px-14">
        <div className="mb-10 flex items-center gap-2.5 md:hidden">
          <div className="grid h-7 w-7 place-items-center rounded bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">P</div>
          <span className="font-bold tracking-tight">ProcureFlow</span>
        </div>
        <div className="mx-auto w-full max-w-sm rise" key={isSignup ? "s" : "l"}>
          <div className="num mb-2 text-[11px] uppercase tracking-[0.2em] text-accent">{isSignup ? "New account" : "Welcome back"}</div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{isSignup ? "Open your ledger" : "Login"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{isSignup ? "Create an account to work in the shared procurement workspace." : "Pick up where the team left off."}</p>

          <div ref={alertRef} tabIndex={-1} role="alert" aria-live="assertive" className="outline-none">
            {formError && (
              <div className="mt-6 flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="status-auth-error">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span>{formError}</span>
              </div>
            )}
          </div>

          <form onSubmit={submit} noValidate className="mt-6 space-y-4" aria-busy={pending}>
            {isSignup && input("name", "Full name", "text", "name")}
            {input("email", "Email", "email", "email")}
            {input("password", "Password", "password", isSignup ? "new-password" : "current-password", isSignup ? "At least 12 characters." : undefined)}
            {isSignup && input("passwordConfirmation", "Confirm password", "password", "new-password")}
            <button type="submit" disabled={pending} data-testid="button-submit-auth"
              className="group mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none">
              {pending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{isSignup ? "Creating account" : "Signing in"}</> : <>{isSignup ? "Create account" : "Sign in"}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></>}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            {isSignup ? "Already have an account? " : "New to ProcureFlow? "}
            <Link href={`${isSignup ? "/login" : "/signup"}${qs}`} className="font-semibold text-accent underline-offset-4 hover:underline" data-testid={isSignup ? "link-login" : "link-signup"}>
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>

          <div className="ruled mt-8 rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground/80"><Info className="h-3 w-3" aria-hidden /> Shared workspace</div>
            All accounts see and edit the same procurement dataset. Accounts do not verify manager authority; approver names remain self-entered.
          </div>
        </div>
      </main>
    </div>
  );
}
