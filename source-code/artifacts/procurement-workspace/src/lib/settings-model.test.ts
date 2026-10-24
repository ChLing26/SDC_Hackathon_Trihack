import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTheme, defaults, emptyPasswords, readSettings, replaceSection, sectionDirty,
  settingsKey, validSettings, validatePasswords, validateProfile, writeSettings,
} from "./settings-model.ts";

const account = { name: "Test Buyer", email: "buyer@example.test" };
const storageFixture = () => {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
};
test("defaults use account identity, opt out and default to light", () => {
  const v = defaults(account);
  assert.deepEqual(v.profile, { ...account, bio: "", address: "" });
  assert.deepEqual(v.preferences, { theme: "light" });
  assert.deepEqual(v.notifications, { email: false, push: false });
  assert.deepEqual(v.privacy, { visibility: "private", analytics: false, personalization: false });
});
test("drafts do not mutate saved values; section save/cancel preserves other drafts", () => {
  const saved = defaults(account);
  let draft = replaceSection(saved, "profile", { ...saved.profile, bio: "Draft" });
  draft = replaceSection(draft, "notifications", { email: true, push: false });
  assert.equal(sectionDirty(saved, draft, "profile"), true);
  assert.equal(saved.profile.bio, "");
  const committed = replaceSection(saved, "notifications", draft.notifications);
  assert.equal(committed.profile.bio, "");
  draft = replaceSection(draft, "profile", committed.profile);
  assert.equal(sectionDirty(committed, draft, "profile"), false);
  assert.equal(draft.notifications.email, true);
});
test("save/reload is account-scoped and ignores identity outside local profile", () => {
  const storage = storageFixture();
  const values = replaceSection(defaults(account), "profile", { name: "Local", email: "local@example.test", bio: "Local only", address: "東京都千代田区\n1-2-3, 日本" });
  assert.equal(writeSettings(1, values, () => storage), null);
  assert.deepEqual(readSettings(1, defaults(account), () => storage).values, values);
  assert.deepEqual(readSettings(2, defaults(account), () => storage).values, defaults(account));
  storage.entries.set(settingsKey(2), storage.entries.get(settingsKey(1))!);
  assert.ok(readSettings(2, defaults(account), () => storage).error);
  assert.deepEqual(account, { name: "Test Buyer", email: "buyer@example.test" });
});
test("malformed, old, partial and secret-bearing records fail safely without writes", () => {
  const storage = storageFixture();
  for (const raw of ["{", "null", JSON.stringify({ version: 2, accountId: 1, values: defaults(account) }),
    JSON.stringify({ version: 1, accountId: 1, values: {} }),
    JSON.stringify({ version: 1, accountId: 1, values: { ...defaults(account), password: "not-allowed" } })]) {
    storage.entries.set(settingsKey(1), raw);
    const result = readSettings(1, defaults(account), () => storage);
    assert.ok(result.error);
    assert.deepEqual(result.values, defaults(account));
    assert.equal(storage.entries.get(settingsKey(1)), raw);
  }
});
test("storage access and quota failures never report successful writes", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  assert.ok(readSettings(1, defaults(account), blocked).error);
  assert.match(writeSettings(1, defaults(account), blocked)!, /Nothing was saved/);
  const quota = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.match(writeSettings(1, defaults(account), () => quota)!, /draft is still available/);
});
test("invalid settings cannot be persisted and damaged storage can be replaced explicitly", () => {
  const storage = storageFixture();
  assert.equal(validSettings({ ...defaults(account), preferences: { theme: "system" } }), false);
  const invalid = replaceSection(defaults(account), "profile", { name: "", email: "invalid", bio: "", address: "" });
  assert.ok(writeSettings(1, invalid, () => storage));
  assert.equal(storage.entries.size, 0);
  storage.entries.set(settingsKey(1), "broken");
  assert.equal(writeSettings(1, defaults(account), () => storage), null);
  assert.equal(readSettings(1, defaults(account), () => storage).error, null);
});
test("profile validation covers required fields, email and limits", () => {
  const profile = defaults(account).profile;
  assert.equal(Object.keys(validateProfile(profile)).length, 0);
  assert.ok(validateProfile({ ...profile, name: " ", email: "not-an-email", bio: "x".repeat(501) }).name);
  assert.ok(validateProfile({ ...profile, name: "x".repeat(101), email: "a@b.test" }).name);
  assert.ok(validateProfile({ ...profile, email: "bad" }).email);
  assert.ok(validateProfile({ ...profile, bio: "x".repeat(501) }).bio);
});
test("address is optional, free-form and limited to 500 characters", () => {
  for (const address of ["", "x", "x".repeat(500), "  ١٢ شارع النيل\nالقاهرة، مصر  ", "東京都千代田区\n日本", "12 rue de l'Église\n75001 Paris"]) {
    const values = defaults(account);
    values.profile.address = address;
    assert.deepEqual(validateProfile(values.profile), {});
    assert.equal(validSettings(values), true);
  }
  const values = defaults(account);
  values.profile.address = "x".repeat(501);
  assert.match(validateProfile(values.profile).address!, /500/);
  assert.equal(validSettings(values), false);
  const storage = storageFixture();
  assert.ok(writeSettings(1, values, () => storage));
  assert.equal(storage.entries.size, 0);
});
test("address edits cancel independently, save verbatim, reload and clear", () => {
  const storage = storageFixture();
  const saved = defaults(account);
  const address = "  12 Jalan Merdeka\nKuala Lumpur, Malaysia  ";
  let draft = replaceSection(saved, "profile", { ...saved.profile, address });
  draft = replaceSection(draft, "notifications", { email: true, push: true });
  assert.equal(sectionDirty(saved, draft, "profile"), true);
  assert.equal(saved.profile.address, "");
  const cancelled = replaceSection(draft, "profile", saved.profile);
  assert.equal(sectionDirty(saved, cancelled, "profile"), false);
  assert.equal(cancelled.profile.address, "");
  assert.deepEqual(cancelled.notifications, draft.notifications);
  const committed = replaceSection(saved, "profile", draft.profile);
  assert.equal(writeSettings(1, committed, () => storage), null);
  const loaded = readSettings(1, defaults(account), () => storage);
  assert.equal(loaded.error, null);
  assert.equal(loaded.values.profile.address, address);
  assert.deepEqual(loaded.values.notifications, saved.notifications);
  assert.equal(readSettings(2, defaults(account), () => storage).values.profile.address, "");
  const cleared = replaceSection(loaded.values, "profile", { ...loaded.values.profile, address: "" });
  assert.equal(sectionDirty(loaded.values, cleared, "profile"), true);
  assert.equal(writeSettings(1, cleared, () => storage), null);
  assert.deepEqual(readSettings(1, defaults(account), () => storage).values, saved);
});
test("known legacy profiles migrate with or without removed language, without writes or lost settings", () => {
  const storage = storageFixture();
  const expected = {
    ...defaults(account),
    profile: { name: "Local name", email: "local@example.test", bio: "Saved bio", address: "" },
    preferences: { theme: "dark" as const },
    notifications: { email: true, push: true },
    privacy: { visibility: "public" as const, analytics: true, personalization: true },
  };
  const { address: _address, ...legacyProfile } = expected.profile;
  for (const preferences of [expected.preferences, ...["en", "ms", "zh"].map(language => ({ ...expected.preferences, language }))]) {
    const raw = JSON.stringify({ version: 1, accountId: 1, values: { ...expected, profile: legacyProfile, preferences } });
    storage.entries.set(settingsKey(1), raw);
    const loaded = readSettings(1, defaults(account), () => storage);
    assert.equal(loaded.error, null);
    assert.deepEqual(loaded.values, expected);
    assert.equal(storage.entries.get(settingsKey(1)), raw);
    assert.equal(writeSettings(1, loaded.values, () => storage), null);
    assert.deepEqual(JSON.parse(storage.entries.get(settingsKey(1))!).values, expected);
  }
});
test("migration does not accept malformed or unsupported profile records", () => {
  const storage = storageFixture();
  const { address: _address, ...legacy } = defaults(account).profile;
  const profiles = [
    { ...legacy, address: null }, { ...legacy, address: 123 }, { ...legacy, address: [] },
    { ...legacy, address: "x".repeat(501) }, { ...legacy, name: null },
    { ...legacy, password: "not-allowed" }, { ...defaults(account).profile, extra: true },
    { name: account.name, email: account.email }, null, [],
  ];
  for (const profile of profiles) {
    const raw = JSON.stringify({ version: 1, accountId: 1, values: { ...defaults(account), profile } });
    storage.entries.set(settingsKey(1), raw);
    assert.ok(readSettings(1, defaults(account), () => storage).error);
    assert.equal(storage.entries.get(settingsKey(1)), raw);
  }
  for (const language of ["fr", null, 1]) {
    const raw = JSON.stringify({ version: 1, accountId: 1, values: { ...defaults(account), profile: legacy, preferences: { theme: "dark", language } } });
    storage.entries.set(settingsKey(1), raw);
    assert.ok(readSettings(1, defaults(account), () => storage).error);
    assert.equal(storage.entries.get(settingsKey(1)), raw);
  }
  assert.equal(validSettings({ ...defaults(account), profile: legacy }), false);
});
test("password policy boundaries, required fields, matching, and distinct values", () => {
  assert.equal(Object.keys(validatePasswords(emptyPasswords())).length, 3);
  for (const length of [11, 129]) assert.ok(validatePasswords({ current: "c".repeat(12), next: "n".repeat(length), confirm: "n".repeat(length) }).next);
  for (const length of [12, 128]) assert.deepEqual(validatePasswords({ current: "c".repeat(12), next: "n".repeat(length), confirm: "n".repeat(length) }), {});
  assert.ok(validatePasswords({ current: "c".repeat(12), next: "c".repeat(12), confirm: "c".repeat(12) }).next);
  assert.ok(validatePasswords({ current: "c".repeat(12), next: "n".repeat(12), confirm: "different" }).confirm);
  assert.deepEqual(emptyPasswords(), { current: "", next: "", confirm: "" });
});
test("theme restoration uses account saved preference and toggles color scheme", () => {
  const storage = storageFixture();
  const values = replaceSection(defaults(account), "preferences", { theme: "dark" });
  writeSettings(1, values, () => storage);
  const classes = new Set<string>();
  const root = { classList: { toggle: (name: string, active: boolean) => { if (active) classes.add(name); else classes.delete(name); } }, style: { colorScheme: "" } };
  applyTheme(readSettings(1, defaults(account), () => storage).values.preferences.theme, root as unknown as HTMLElement);
  assert.equal(classes.has("dark"), true);
  assert.equal(root.style.colorScheme, "dark");
  applyTheme(readSettings(2, defaults(account), () => storage).values.preferences.theme, root as unknown as HTMLElement);
  assert.equal(classes.has("dark"), false);
  assert.equal(root.style.colorScheme, "light");
});
test("earlier language preferences are discarded without losing other saved choices", () => {
  const storage = storageFixture();
  const expected = {
    ...defaults(account),
    profile: { name: "Local name", email: "local@example.test", bio: "Saved bio", address: "" },
    preferences: { theme: "dark" as const },
    notifications: { email: true, push: true },
    privacy: { visibility: "team" as const, analytics: true, personalization: true },
  };
  for (const language of ["en", "ms", "zh"]) {
    const legacy = { ...expected, preferences: { ...expected.preferences, language } };
    storage.entries.set(settingsKey(1), JSON.stringify({ version: 1, accountId: 1, values: legacy }));
    const loaded = readSettings(1, defaults(account), () => storage);
    assert.equal(loaded.error, null);
    assert.deepEqual(loaded.values, expected);
    assert.equal(writeSettings(1, loaded.values, () => storage), null);
    assert.equal(storage.entries.get(settingsKey(1))!.includes('"language"'), false);
    assert.deepEqual(readSettings(2, defaults(account), () => storage).values, defaults(account));
  }
});
test("dark foregrounds and focus ring meet readable contrast against their surfaces", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const dark = css.split(".dark {")[1].split("\n}")[0];
  const luminance = (token: string) => {
    const match = dark.match(new RegExp(`--${token}: ([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
    assert.ok(match, token);
    const h = Number(match[1]) / 360, s = Number(match[2]) / 100, l = Number(match[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const rgb = [0, 8, 4].map(n => {
      const k = (n + h * 12) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [text, surface] of [
    ["foreground", "background"], ["card-foreground", "card"], ["muted-foreground", "card"],
    ["muted-foreground", "muted"], ["popover-foreground", "popover"], ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"], ["accent-foreground", "accent"],
    ["sidebar-foreground", "sidebar"], ["sidebar-accent-foreground", "sidebar-accent"],
  ]) {
    const a = luminance(text), b = luminance(surface);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${text} on ${surface}`);
  }
  assert.ok((luminance("ring") + .05) / (luminance("card") + .05) >= 3);
});
