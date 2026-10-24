import { type FormEvent, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ShieldCheck, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { validatePasswords } from "@/lib/settings";
import { Note, SectionHeader } from "./section-frame";

type K = "current" | "next" | "confirm";
const EMPTY = { current: "", next: "", confirm: "" };
const LABELS: Record<K, string> = { current: "Current password", next: "New password", confirm: "Confirm new password" };

/** Password values live only in this component's state and are wiped on submit, unmount, or sign-out. */
export function SecuritySection() {
  const { isLoggingOut } = useAuth();
  const [pw, setPw] = useState(EMPTY);
  const [show, setShow] = useState<Record<K, boolean>>({ current: false, next: false, confirm: false });
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) };

  useEffect(() => { if (isLoggingOut) setPw(EMPTY); }, [isLoggingOut]);
  useEffect(() => () => setPw(EMPTY), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validatePasswords(pw);
    setPw(EMPTY);
    setErrors(errs);
    const first = (["current", "next", "confirm"] as K[]).find((k) => errs[k]);
    if (first) { setStatus("Fields were cleared for safety. Fix the noted issues and re-enter them."); refs[first].current?.focus(); return; }
    setStatus("Backend connection required. No password was changed and your current password was not checked. Fields were cleared.");
  };

  return (
    <section>
      <SectionHeader kicker="02 / Security" title="Account & security"
        body="Password changes are not connected to the server yet. This form checks format only." />
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-security">
        {(Object.keys(LABELS) as K[]).map((k) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={`pw-${k}`}>{LABELS[k]}</Label>
            <div className="relative">
              <Input id={`pw-${k}`} ref={refs[k]} type={show[k] ? "text" : "password"} autoComplete={k === "current" ? "current-password" : "new-password"}
                value={pw[k]} onChange={(e) => { setPw({ ...pw, [k]: e.target.value }); setErrors((x) => ({ ...x, [k]: undefined })); }}
                aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `pw-${k}-err` : undefined} className="pr-11" data-testid={`input-password-${k}`} />
              <button type="button" onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} aria-pressed={show[k]} aria-controls={`pw-${k}`}
                aria-label={`${show[k] ? "Hide" : "Show"} ${LABELS[k].toLowerCase()}`} data-testid={`button-toggle-${k}`}
                className="absolute inset-y-0 right-1 my-auto grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                {show[k] ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            {errors[k] && <p id={`pw-${k}-err`} className="text-xs text-destructive" data-testid={`error-password-${k}`}>{errors[k]}</p>}
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">New passwords must be 12 to 128 characters.</p>
        <div className="flex flex-wrap items-center gap-3 border-t border-dashed pt-4">
          <Button type="submit" data-testid="button-submit-password">Check new password</Button>
          <Button type="button" variant="outline" disabled={!pw.current && !pw.next && !pw.confirm}
            data-testid="button-cancel-password" onClick={() => {
              setPw(EMPTY);
              setShow({ current: false, next: false, confirm: false });
              setErrors({});
              setStatus("Password draft discarded. No account changes were made.");
            }}>Cancel</Button>
          <p role="status" aria-live="polite" className="min-w-0 flex-1 text-xs text-accent" data-testid="status-security">{status}</p>
        </div>
      </form>
      <div className="mt-8 rounded-md border bg-card p-4" data-testid="panel-account-safety">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />How this account is protected</div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>Passwords are stored hashed on the server, never in plain text.</li>
          <li>Your current session uses an HttpOnly cookie and lasts up to seven days. Production cookies require HTTPS.</li>
          <li>Signing out ends this browser's session.</li>
        </ul>
        <div className="mt-3"><Note tone="warn"><Info className="mr-1 inline h-3 w-3" aria-hidden />Not available yet: two-factor authentication, listing or revoking other sessions, and password recovery.</Note></div>
      </div>
    </section>
  );
}
