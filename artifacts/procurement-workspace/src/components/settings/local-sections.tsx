import { type ReactNode } from "react";
import { Sun, Moon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";
import { Note, SectionForm, SectionHeader } from "./section-frame";

function ToggleRow({ id, label, body, checked, onChange }: { id: string; label: string; body: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border bg-card/60 p-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
        <p id={`${id}-desc`} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-desc`} data-testid={`switch-${id}`} />
    </div>
  );
}

function Choice({ value, id, children }: { value: string; id: string; children: ReactNode }) {
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border bg-card/60 p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary/40">
      <RadioGroupItem value={value} id={id} className="mt-0.5" data-testid={`radio-${id}`} />
      <span className="min-w-0 text-xs leading-relaxed">{children}</span>
    </Label>
  );
}

export function PreferencesSection() {
  const { draft, update } = useSettings();
  const p = draft.preferences;
  return (
    <section>
      <SectionHeader kicker="03 / Preferences" title="Preferences & appearance" body="Theme previews immediately. Save to keep it; cancel to restore." />
      <SectionForm section="preferences" label="Preferences">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Theme</legend>
          <RadioGroup value={p.theme} onValueChange={(v) => update("preferences", { ...p, theme: v as "light" | "dark" })} className="grid gap-3 sm:grid-cols-2">
            {(["light", "dark"] as const).map((t) => (
              <Label key={t} htmlFor={`theme-${t}`} className="cursor-pointer rounded-md border bg-card/60 p-3 has-[[data-state=checked]]:border-primary">
                <div className={cn("mb-3 h-14 rounded border", t === "light" ? "bg-[hsl(38_54%_96%)]" : "bg-[hsl(165_18%_14%)]")} aria-hidden>
                  <div className={cn("m-2 h-2 w-1/2 rounded", t === "light" ? "bg-[hsl(153_32%_80%)]" : "bg-[hsl(153_25%_55%)]")} />
                  <div className={cn("mx-2 h-2 w-1/3 rounded", t === "light" ? "bg-[hsl(345_45%_81%)]" : "bg-[hsl(345_30%_60%)]")} />
                </div>
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <RadioGroupItem value={t} id={`theme-${t}`} data-testid={`radio-theme-${t}`} />
                  {t === "light" ? <Sun className="h-3.5 w-3.5" aria-hidden /> : <Moon className="h-3.5 w-3.5" aria-hidden />}
                  {t === "light" ? "Light paper" : "Dark desk"}
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      </SectionForm>
    </section>
  );
}

export function NotificationsSection() {
  const { draft, update } = useSettings();
  const n = draft.notifications;
  return (
    <section>
      <SectionHeader kicker="04 / Notifications" title="Notifications" body="Record how you would like to hear about approvals and quotes once delivery exists." />
      <SectionForm section="notifications" label="Notification preferences">
        <ToggleRow id="notify-email" label="Email updates" body="Preference only. No emails are sent by ProcureFlow today."
          checked={n.email} onChange={(v) => update("notifications", { ...n, email: v })} />
        <ToggleRow id="notify-push" label="Push alerts" body="Preference only. This does not request browser notification permission or send alerts."
          checked={n.push} onChange={(v) => update("notifications", { ...n, push: v })} />
        <Note>Saved in this browser for this account only. Nothing is delivered and no other device sees these choices.</Note>
      </SectionForm>
    </section>
  );
}

export function PrivacySection() {
  const { draft, update } = useSettings();
  const p = draft.privacy;
  return (
    <section>
      <SectionHeader kicker="05 / Privacy" title="Privacy & data" body="Browser-local preferences. None of them are enforced by the server." />
      <SectionForm section="privacy" label="Privacy preferences">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Profile card visibility</legend>
          <RadioGroup value={p.visibility} onValueChange={(v) => update("privacy", { ...p, visibility: v as "private" | "team" | "public" })} className="grid gap-2">
            <Choice value="private" id="vis-private"><strong>Private</strong> - keep the card to yourself.</Choice>
            <Choice value="team" id="vis-team"><strong>Team</strong> - intended for workspace colleagues.</Choice>
            <Choice value="public" id="vis-public"><strong>Public</strong> - intended for anyone.</Choice>
          </RadioGroup>
          <p className="mt-2 text-[11px] text-muted-foreground">Intent only: there are no profile pages and this choice is not enforced anywhere.</p>
        </fieldset>
        <ToggleRow id="privacy-analytics" label="Usage analytics" body="Preference only. This switch does not activate analytics or change any telemetry policy."
          checked={p.analytics} onChange={(v) => update("privacy", { ...p, analytics: v })} />
        <ToggleRow id="privacy-personalization" label="Personalised insights" body="Preference only. Insights are not tailored per person today."
          checked={p.personalization} onChange={(v) => update("privacy", { ...p, personalization: v })} />
        <Note testId="text-privacy-shared">These settings never hide or restrict procurement data. Requests, quotes, approvals, and invoices remain shared with every workspace account.</Note>
      </SectionForm>
    </section>
  );
}
