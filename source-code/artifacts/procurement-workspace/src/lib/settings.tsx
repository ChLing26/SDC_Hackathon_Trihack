import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import {
  applyTheme, defaults, readSettings, replaceSection, sectionDirty, validateProfile, writeSettings,
  type Section, type SettingsValues,
} from "./settings-model";
export { validateProfile, validatePasswords } from "./settings-model";
export type { SettingsValues } from "./settings-model";

type SettingsContextValue = {
  draft: SettingsValues;
  saved: SettingsValues;
  update: <K extends Section>(section: K, value: SettingsValues[K]) => void;
  save: (section: Section) => boolean;
  cancel: (section: Section) => void;
  isDirty: (section: Section) => boolean;
  storageError: string | null;
  notice: string;
  retryStorage: () => void;
};
const SettingsContext = createContext<SettingsContextValue | null>(null);
const browserStorage = () => window.localStorage;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <AccountSettings key={user.id} account={user}>{children}</AccountSettings>;
  return <SignedOutTheme>{children}</SignedOutTheme>;
}

function SignedOutTheme({ children }: { children: ReactNode }) {
  useLayoutEffect(() => { applyTheme("light", document.documentElement); }, []);
  return children;
}

function AccountSettings({ account, children }: { account: { id: number; name: string; email: string }; children: ReactNode }) {
  const [initial] = useState(() => readSettings(account.id, defaults(account), browserStorage));
  const [saved, setSaved] = useState(initial.values);
  const [draft, setDraft] = useState(initial.values);
  const [storageError, setStorageError] = useState(initial.error);
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => { applyTheme(draft.preferences.theme, document.documentElement); }, [draft.preferences.theme]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((Object.keys(saved) as Section[]).some(section => sectionDirty(saved, draft, section))) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved, draft]);

  const update = <K extends Section>(section: K, value: SettingsValues[K]) => {
    setDraft(current => replaceSection(current, section, value));
    setNotice("");
  };
  const save = (section: Section) => {
    setNotice("");
    if (section === "profile" && Object.keys(validateProfile(draft.profile)).length) {
      setNotice("Check the highlighted profile fields. Nothing was saved.");
      return false;
    }
    const value = section === "profile"
      ? { ...draft.profile, name: draft.profile.name.trim(), email: draft.profile.email.trim() }
      : draft[section];
    const next = { ...saved, [section]: value };
    const error = writeSettings(account.id, next, browserStorage);
    setStorageError(error);
    if (error) return false;
    setSaved(next);
    setDraft(current => ({ ...current, [section]: value }));
    setNotice("Saved in this browser for your account only. No server settings were changed.");
    return true;
  };
  const cancel = (section: Section) => {
    setDraft(current => ({ ...current, [section]: saved[section] }));
    setNotice("Unsaved changes in this section were cancelled.");
  };
  const retryStorage = () => {
    const result = readSettings(account.id, defaults(account), browserStorage);
    setStorageError(result.error);
    setNotice(result.error ? "" : "Storage can be read again. Your current drafts are unchanged; use Save to store them.");
  };
  return <SettingsContext.Provider value={{
    draft, saved, update, save, cancel, isDirty: section => sectionDirty(saved, draft, section),
    storageError, notice, retryStorage,
  }}>{children}</SettingsContext.Provider>;
}
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("Account settings provider is missing.");
  return context;
}
