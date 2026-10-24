import { type FormEvent, type ReactNode, useState } from "react";
import { Check, AlertTriangle, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";

type Section = "profile" | "preferences" | "notifications" | "privacy";

export function SectionHeader({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="mb-6 border-b border-dashed pb-4">
      <div className="num mb-1 text-[10px] uppercase tracking-[0.2em] text-accent">{kicker}</div>
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function Note({ children, tone = "info", testId }: { children: ReactNode; tone?: "info" | "warn"; testId?: string }) {
  return (
    <p data-testid={testId} className={cn("rounded-md border px-3 py-2 text-[11px] leading-relaxed",
      tone === "warn" ? "border-chart-4/60 bg-chart-4/10" : "border-secondary bg-secondary/40 text-secondary-foreground")}>{children}</p>
  );
}

/** Local form wrapper with per-section save/cancel, dirty marker, and honest status. */
export function SectionForm({ section, children, validate, label, onCancel }: {
  section: Section; children: ReactNode; label: string; validate?: () => boolean; onCancel?: () => void;
}) {
  const { save, cancel, isDirty, storageError } = useSettings();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const dirty = isDirty(section);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (validate && !validate()) { setStatus({ ok: false, msg: "Fix the highlighted fields before saving." }); return; }
    const ok = save(section);
    setStatus(ok ? { ok: true, msg: `${label} saved in this browser only.` }
      : { ok: false, msg: storageError ?? "Browser storage is unavailable, so nothing was saved. Your draft is kept on this page." });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-5" data-testid={`form-${section}`}>
      {children}
      <div className="flex flex-wrap items-center gap-3 border-t border-dashed pt-4">
        <Button type="submit" disabled={!dirty} data-testid={`button-save-${section}`}>Save {label.toLowerCase()}</Button>
        <Button type="button" variant="outline" disabled={!dirty} data-testid={`button-cancel-${section}`}
          onClick={() => { cancel(section); onCancel?.(); setStatus({ ok: true, msg: "Unsaved edits discarded." }); }}>Cancel</Button>
        <div role="status" aria-live="polite" className="min-w-0 flex-1 text-xs" data-testid={`status-${section}`}>
          {dirty ? <span className="inline-flex items-center gap-1.5 text-accent"><PenLine className="h-3.5 w-3.5" aria-hidden />Unsaved changes</span>
            : status && <span className={cn("inline-flex items-center gap-1.5", status.ok ? "text-primary" : "text-destructive")}>
              {status.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}{status.msg}</span>}
          {dirty && status && !status.ok && <span className="ml-2 text-destructive">{status.msg}</span>}
        </div>
      </div>
    </form>
  );
}
