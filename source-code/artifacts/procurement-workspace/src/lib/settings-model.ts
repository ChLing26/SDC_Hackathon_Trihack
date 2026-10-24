export type SettingsValues = {
  profile: { name: string; email: string; bio: string; address: string };
  preferences: { theme: "light" | "dark" };
  notifications: { email: boolean; push: boolean };
  privacy: { visibility: "private" | "team" | "public"; analytics: boolean; personalization: boolean };
};
export type Section = keyof SettingsValues;
export type PasswordValues = { current: string; next: string; confirm: string };
export const emptyPasswords = (): PasswordValues => ({ current: "", next: "", confirm: "" });

export function defaults(user: { name: string; email: string }): SettingsValues {
  return {
    profile: { name: user.name, email: user.email, bio: "", address: "" },
    preferences: { theme: "light" },
    notifications: { email: false, push: false },
    privacy: { visibility: "private", analytics: false, personalization: false },
  };
}
export function validateProfile(profile: SettingsValues["profile"]) {
  const errors: Partial<Record<keyof SettingsValues["profile"], string>> = {};
  if (!profile.name.trim() || profile.name.trim().length > 100) errors.name = "Enter a name between 1 and 100 characters.";
  if (profile.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) errors.email = "Enter a valid email address (up to 254 characters).";
  if (profile.bio.length > 500) errors.bio = "Keep your bio to 500 characters or fewer.";
  if (profile.address.length > 500) errors.address = "Keep your address to 500 characters or fewer.";
  return errors;
}
export function validatePasswords(values: PasswordValues) {
  const errors: Partial<Record<keyof PasswordValues, string>> = {};
  if (values.current.length < 12 || values.current.length > 128) errors.current = "Enter your current password (12–128 characters). It will not be verified.";
  if (values.next.length < 12 || values.next.length > 128) errors.next = "Use between 12 and 128 characters.";
  else if (values.next === values.current) errors.next = "Choose a different new password.";
  if (!values.confirm) errors.confirm = "Confirm the new password.";
  else if (values.confirm !== values.next) errors.confirm = "Passwords do not match.";
  return errors;
}

const sections: Section[] = ["profile", "preferences", "notifications", "privacy"];
const sameKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Strict whitelisting keeps unsupported fields and credentials out of saved state. */
export function validSettings(value: unknown): value is SettingsValues {
  if (!sameKeys(value, sections)) return false;
  const { profile: p, preferences: a, notifications: n, privacy: d } = value;
  return sameKeys(p, ["name", "email", "bio", "address"]) &&
    typeof p.name === "string" && typeof p.email === "string" && typeof p.bio === "string" && typeof p.address === "string" &&
    Object.keys(validateProfile(p as SettingsValues["profile"])).length === 0 &&
    sameKeys(a, ["theme"]) && ["light", "dark"].includes(String(a.theme)) &&
    sameKeys(n, ["email", "push"]) && typeof n.email === "boolean" && typeof n.push === "boolean" &&
    sameKeys(d, ["visibility", "analytics", "personalization"]) && ["private", "team", "public"].includes(String(d.visibility)) &&
    typeof d.analytics === "boolean" && typeof d.personalization === "boolean";
}
export const settingsKey = (id: number) => `procureflow:settings:v1:account:${id}`;
export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;
export type LoadedSettings = { values: SettingsValues; error: string | null };
export function readSettings(id: number, fallback: SettingsValues, storage: () => SettingsStorage): LoadedSettings {
  try {
    const raw = storage().getItem(settingsKey(id));
    if (raw === null) return { values: fallback, error: null };
    const parsed: unknown = JSON.parse(raw);
    if (!sameKeys(parsed, ["version", "accountId", "values"]) || parsed.version !== 1 || parsed.accountId !== id) {
      throw new Error("Invalid settings");
    }
    let values = parsed.values;
    // Accept earlier records without resetting the account's other saved choices.
    // Only the exact known legacy profile shape may receive an empty address.
    if (sameKeys(values, sections) && sameKeys(values.profile, ["name", "email", "bio"])) {
      values = { ...values, profile: { ...values.profile, address: "" } };
    }
    // The removed language field is discarded and is never written again.
    if (sameKeys(values, sections) && sameKeys(values.preferences, ["theme", "language"]) &&
      typeof values.preferences.language === "string" && ["en", "ms", "zh"].includes(values.preferences.language)) {
      values = { ...values, preferences: { theme: values.preferences.theme } };
    }
    if (!validSettings(values)) throw new Error("Invalid settings");
    return { values, error: null };
  } catch {
    return { values: fallback, error: "Saved settings could not be read. Browser storage may be blocked or the saved data is damaged. Allow site storage and retry, or save a section to replace damaged settings. Defaults are shown; nothing has been overwritten." };
  }
}
export function writeSettings(id: number, values: SettingsValues, storage: () => SettingsStorage): string | null {
  try {
    if (!validSettings(values)) return "Check the settings fields before saving.";
    storage().setItem(settingsKey(id), JSON.stringify({ version: 1, accountId: id, values }));
    return null;
  } catch {
    return "Nothing was saved. Allow site storage in your browser settings or free some browser storage, then try Save again. Your draft is still available in this tab.";
  }
}
export const sectionDirty = <K extends Section>(saved: SettingsValues, draft: SettingsValues, section: K) =>
  JSON.stringify(saved[section]) !== JSON.stringify(draft[section]);
export function replaceSection<K extends Section>(values: SettingsValues, section: K, next: SettingsValues[K]): SettingsValues {
  return { ...values, [section]: next };
}
export function applyTheme(theme: SettingsValues["preferences"]["theme"], root: Pick<HTMLElement, "classList" | "style">) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
