import { type ReactNode, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useSettings, validateProfile } from "@/lib/settings";
import { Note, SectionForm, SectionHeader } from "./section-frame";

type Key = "name" | "email" | "address" | "bio";

export function ProfileSection() {
  const { draft, update } = useSettings();
  const { user } = useAuth();
  const p = draft.profile;
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const refs = {
    name: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null),
    address: useRef<HTMLTextAreaElement>(null), bio: useRef<HTMLTextAreaElement>(null),
  };
  const set = (k: Key, v: string) => { update("profile", { ...p, [k]: v }); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })); };
  const validate = () => {
    const e = validateProfile(p); setErrors(e);
    const first = (["name", "email", "address", "bio"] as Key[]).find((k) => e[k]);
    if (first) refs[first].current?.focus();
    return !first;
  };
  const field = (k: Key, label: string, hint: string, el: ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={`profile-${k}`}>{label}</Label>
      {el}
      {errors[k] ? <p id={`profile-${k}-err`} className="text-xs text-destructive" data-testid={`error-profile-${k}`}>{errors[k]}</p>
        : <p id={`profile-${k}-hint`} className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
  const aria = (k: Key) => ({ "aria-invalid": !!errors[k], "aria-describedby": errors[k] ? `profile-${k}-err` : `profile-${k}-hint` });
  return (
    <section>
      <SectionHeader kicker="01 / Personal" title="Personal information"
        body="A local display card for this browser. Seeded from your signed-in account, then kept separate from it." />
      <SectionForm section="profile" label="Profile" validate={validate} onCancel={() => setErrors({})}>
        {field("name", "Display name", "Shown only on this settings card.",
          <Input id="profile-name" ref={refs.name} value={p.name} onChange={(e) => set("name", e.target.value)} {...aria("name")} data-testid="input-profile-name" />)}
        {field("email", "Contact email", "A note for yourself; it is not your login email.",
          <Input id="profile-email" type="email" ref={refs.email} value={p.email} onChange={(e) => set("email", e.target.value)} {...aria("email")} data-testid="input-profile-email" />)}
        {field("address", "Address", "Optional. Up to 500 characters, in any address format.",
          <Textarea id="profile-address" name="address" autoComplete="street-address" ref={refs.address} rows={3}
            value={p.address} onChange={(e) => set("address", e.target.value)} {...aria("address")} data-testid="input-profile-address" />)}
        {field("bio", "Bio", "Optional. A short line about your purchasing role.",
          <Textarea id="profile-bio" ref={refs.bio} rows={4} value={p.bio} onChange={(e) => set("bio", e.target.value)} {...aria("bio")} data-testid="input-profile-bio" />)}
        <Note testId="text-profile-disclosure">
          Profile information is saved in this browser for your account only. Saving here does not change your account name or login email{user ? <> (still <strong className="break-all">{user.email}</strong>)</> : null}, and it does not edit
          shipping destinations or any shared request, approval, or invoice. Procurement records stay shared with every workspace account; nothing here makes them yours.
        </Note>
      </SectionForm>
    </section>
  );
}
