import { useState } from "react";
import { User, KeyRound, Palette, Bell, Lock, AlertTriangle, RotateCw, Info } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHead } from "@/components/shell";
import { useSettings } from "@/lib/settings";
import { ProfileSection } from "@/components/settings/profile-section";
import { SecuritySection } from "@/components/settings/security-section";
import { PreferencesSection, NotificationsSection, PrivacySection } from "@/components/settings/local-sections";

const TABS = [
  { id: "profile", label: "Personal Information", icon: User, el: <ProfileSection /> },
  { id: "security", label: "Account & Security", icon: KeyRound, el: <SecuritySection /> },
  { id: "preferences", label: "Preferences & Appearance", icon: Palette, el: <PreferencesSection /> },
  { id: "notifications", label: "Notifications", icon: Bell, el: <NotificationsSection /> },
  { id: "privacy", label: "Privacy & Data", icon: Lock, el: <PrivacySection /> },
] as const;
const DIRTY_KEYS: Record<string, "profile" | "preferences" | "notifications" | "privacy" | undefined> =
  { profile: "profile", preferences: "preferences", notifications: "notifications", privacy: "privacy" };

export default function SettingsPage() {
  const { storageError, notice, retryStorage, isDirty } = useSettings();
  const [tab, setTab] = useState<string>("profile");
  return (
    <div className="min-w-0">
      <PageHead kicker="Your desk" title="Settings" description="Personal preferences for this browser. The procurement ledger itself stays shared by everyone in the workspace." />
      {storageError && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="status-storage-error">
          <span className="flex min-w-0 items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />{storageError} Changes are not being saved.</span>
          <button type="button" onClick={retryStorage} className="inline-flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-xs hover:bg-muted" data-testid="button-retry-storage">
            <RotateCw className="h-3.5 w-3.5" aria-hidden />Try storage again</button>
        </div>
      )}
      {notice && <p role="status" className="mb-5 flex items-start gap-2 rounded-md border border-secondary bg-secondary/40 p-3 text-xs text-secondary-foreground" data-testid="text-settings-notice"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{notice}</p>}
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex flex-col gap-6 md:flex-row md:items-start">
        <TabsList aria-label="Settings sections" className="grid h-auto w-full grid-cols-1 gap-1 rounded-lg border bg-card/70 p-2 sm:grid-cols-2 md:sticky md:top-20 md:w-60 md:shrink-0 md:grid-cols-1">
          {TABS.map(({ id, label, icon: Icon }) => {
            const k = DIRTY_KEYS[id];
            return (
              <TabsTrigger key={id} value={id} data-testid={`tab-${id}`}
                className="relative w-full min-w-0 justify-start gap-2.5 whitespace-normal rounded-md px-3 py-2.5 text-left text-xs data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-none">
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">{label}</span>
                {k && isDirty(k) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="unsaved changes" />}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-5 md:p-8">
          {TABS.map(({ id, el }) => <TabsContent key={id} value={id} className="mt-0 rise focus-visible:outline-none">{el}</TabsContent>)}
        </div>
      </Tabs>
    </div>
  );
}
