import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./components/shell.tsx", import.meta.url), "utf8");
const notFound = readFileSync(new URL("./pages/not-found.tsx", import.meta.url), "utf8");

test("removed /tools links resolve through the standard not-found route", () => {
  assert.match(app, /<Route component={NotFound} \/>/);
  assert.doesNotMatch(app, /<Route path=["']\/tools(?:\/|["'])/);
  assert.match(notFound, /404 Page Not Found/);
});

test("the workspace navigation does not expose Tools or Secrets", () => {
  const navigation = shell.match(/const NAV = \[([\s\S]*?)\n\];/);
  assert.ok(navigation, "the workspace navigation list should exist");
  assert.doesNotMatch(navigation[1], /\/tools|Tools|Secrets/i);
});
