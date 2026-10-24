import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { db, pool, accounts, accountSessions, authAttempts, procurementRecords } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { RegisterAccountResponse } from "@workspace/api-zod";
import app from "../app";
import { digest, SESSION_COOKIE, SESSION_LIFETIME, verifyPassword } from "../lib/auth";

// These tests only create/delete their own accounts and counters, never procurement data.
test("persistent account and session security", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const unique = randomUUID();
  const email = `auth-test-${unique}@example.com`;
  const throttleEmail = `throttle-${unique}@example.com`;
  const password = "test-only-long-passphrase-48";
  const name = "Authentication Test";
  let cookie = "";
  let ipCount = 0;
  const counterKeys: string[] = [];
  const before = await db.select().from(procurementRecords);
  const request = async (path: string, options: {
    data?: unknown; cookie?: string; headers?: Record<string, string>; method?: string;
  } = {}) => {
    const ip = `198.51.100.${++ipCount}`;
    counterKeys.push(`ip:${digest(ip)}`);
    return fetch(`${base}/api${path}`, {
      method: options.method ?? (options.data !== undefined ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        "x-procureflow-request": "1",
        "x-forwarded-for": ip,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers,
      },
      ...(options.data !== undefined ? { body: JSON.stringify(options.data) } : {}),
    });
  };
  const registration = { name, email: `  ${email.toUpperCase()}  `, password, passwordConfirmation: password };
  try {
    await t.test("health is public; all procurement reads and writes reject anonymous requests", async () => {
      assert.equal((await request("/healthz")).status, 200);
      for (const path of ["/dashboard", "/requests", "/requests/1", "/invoices", "/recommendations"]) {
        const response = await request(`/procurement${path}`);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { error: "Please sign in to access the workspace." });
      }
      assert.equal((await request("/procurement/requests", { data: {} })).status, 401);
      assert.equal((await request("/procurement/requests/1/decision", { data: {} })).status, 401);
    });
    await t.test("registration validation is safe, including confirmation and blank names", async () => {
      const response = await request("/auth/register", { data: { ...registration, name: " ", passwordConfirmation: "different-password" } });
      assert.equal(response.status, 400);
      const body = await response.json() as { fields: Record<string, string> };
      assert.ok(body.fields.name);
      assert.ok(body.fields.passwordConfirmation);
      assert.ok(!JSON.stringify(body).includes(password));
      assert.equal((await request("/auth/register", { data: { ...registration, password: "short", passwordConfirmation: "short", email: "invalid" } })).status, 400);
    });
    await t.test("registration persists normalized unique email, salted hash and opaque hashed session", async () => {
      const response = await request("/auth/register", { data: registration });
      assert.equal(response.status, 201);
      const user = RegisterAccountResponse.parse(await response.json());
      assert.deepEqual(Object.keys(user).sort(), ["email", "id", "name"]);
      assert.equal(user.email, email);
      assert.equal(user.name, name);
      const setCookie = response.headers.get("set-cookie")!;
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, /Max-Age=604800/);
      cookie = setCookie.split(";")[0];
      const token = cookie.split("=")[1];
      assert.match(token, /^[a-f0-9]{64}$/);
      const [account] = await db.select().from(accounts).where(eq(accounts.email, email));
      assert.notEqual(account.passwordHash, password);
      assert.match(account.passwordHash, /^scrypt-v1\$/);
      assert.equal(await verifyPassword(password, account.passwordHash), true);
      const [session] = await db.select().from(accountSessions).where(eq(accountSessions.tokenHash, digest(token)));
      assert.equal(session.accountId, account.id);
      assert.notEqual(session.tokenHash, token);
      assert.ok(Math.abs(+session.expiresAt - Date.now() - SESSION_LIFETIME) < 10000);
      assert.equal((await request("/auth/me", { cookie })).status, 200);
      assert.equal((await request("/procurement/requests", { cookie })).status, 200);
    });
    await t.test("case and whitespace normalized duplicates cannot create another account", async () => {
      const response = await request("/auth/register", { data: registration });
      assert.equal(response.status, 409);
      assert.equal((await db.select().from(accounts).where(eq(accounts.email, email))).length, 1);
    });
    await t.test("unknown accounts and wrong passwords get identical generic credential failures", async () => {
      const known = await request("/auth/login", { data: { email, password: "wrong-password" } });
      const unknown = await request("/auth/login", { data: { email: `unknown-${unique}@example.com`, password: "wrong-password" } });
      assert.equal(known.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(await known.json(), await unknown.json());
    });
    await t.test("origin and non-simple-header protection apply to auth and procurement mutations", async () => {
      for (const path of ["/auth/login", "/auth/register", "/auth/logout", "/procurement/requests"]) {
        assert.equal((await request(path, { data: {}, cookie, headers: { origin: "https://evil.example" } })).status, 403);
        assert.equal((await request(path, { data: {}, cookie, headers: { "x-procureflow-request": "" } })).status, 403);
        assert.equal((await request(path, { data: {}, cookie, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
        assert.equal((await request(path, { data: {}, cookie, headers: { origin: "null" } })).status, 403);
      }
      const crossRead = await request("/procurement/requests", { cookie, headers: { origin: "https://evil.example" } });
      assert.equal(crossRead.status, 403);
      assert.equal(crossRead.headers.get("access-control-allow-origin"), null);
      assert.equal((await request("/auth/me", { cookie, headers: { origin: base } })).status, 200);
      assert.equal((await request("/auth/logout", { cookie, data: {}, headers: { "content-type": "text/plain" } })).status, 403);
    });
    await t.test("login rotates the session, signs in normalized email, and uses Secure cookies in production", async () => {
      const previous = process.env.NODE_ENV;
      let response: Response;
      try {
        process.env.NODE_ENV = "production";
        response = await request("/auth/login", { cookie, data: { email: ` ${email.toUpperCase()} `, password } });
      } finally { process.env.NODE_ENV = previous; }
      assert.equal(response!.status, 200);
      assert.match(response!.headers.get("set-cookie")!, /;\s*Secure/i);
      assert.equal((await request("/auth/me", { cookie })).status, 401);
      cookie = response!.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await request("/auth/me", { cookie })).status, 200);
    });
    await t.test("a new server instance resolves the persisted session", async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const restarted = app.listen(0, "127.0.0.1");
      await once(restarted, "listening");
      base = `http://127.0.0.1:${(restarted.address() as AddressInfo).port}`;
      assert.equal((await request("/auth/me", { cookie })).status, 200);
      await new Promise<void>((resolve, reject) => restarted.close(error => error ? reject(error) : resolve()));
      // Continue checks on a fresh listener with no in-memory session bootstrap.
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    await t.test("expired and malformed sessions cannot read procurement data", async () => {
      await db.update(accountSessions).set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accountSessions.tokenHash, digest(cookie.split("=")[1])));
      assert.equal((await request("/procurement/requests", { cookie })).status, 401);
      assert.equal((await request("/auth/me", { cookie: `${SESSION_COOKIE}=not-a-token` })).status, 401);
    });
    await t.test("logout deletes the server session and clears the cookie", async () => {
      const login = await request("/auth/login", { data: { email, password } });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie")!.split(";")[0];
      const response = await request("/auth/logout", { method: "POST", cookie });
      assert.equal(response.status, 204);
      assert.match(response.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
      assert.equal((await db.select().from(accountSessions).where(eq(accountSessions.tokenHash, digest(cookie.split("=")[1])))).length, 0);
      assert.equal((await request("/auth/me", { cookie })).status, 401);
      assert.equal((await request("/procurement/requests", { cookie })).status, 401);
      assert.equal((await request("/auth/logout", { method: "POST" })).status, 204);
    });
    await t.test("persistent throttling limits login and registration", async () => {
      for (let index = 0; index < 10; index++) {
        assert.equal((await request("/auth/login", { data: { email: throttleEmail, password: "bad-password" } })).status, 401);
      }
      const limited = await request("/auth/login", { data: { email: throttleEmail, password: "bad-password" } });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
      assert.equal((await request("/auth/register", { data: { ...registration, email: throttleEmail } })).status, 429);
      assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.key, `email:${digest(throttleEmail)}`)))[0].count, 12);
    });
    await t.test("temporary failures do not expose internals and existing procurement records are unchanged", async () => {
      const select = t.mock.method(db, "select", () => { throw new Error("private-database-details"); });
      try {
        const unavailable = await request("/auth/me", { cookie });
        assert.equal(unavailable.status, 503);
        assert.deepEqual(await unavailable.json(), { error: "The service is temporarily unavailable. Please try again." });
      } finally { select.mock.restore(); }
      // Invalid JSON is handled with safe messages rather than Express stack traces.
      const response = await fetch(`${base}/api/auth/login`, { method: "POST",
        headers: { "content-type": "application/json", "x-procureflow-request": "1" }, body: "{" });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "The request is invalid. Please check your input." });
      assert.deepEqual(await db.select().from(procurementRecords), before);
    });
  } finally {
    await db.delete(accounts).where(eq(accounts.email, email));
    await db.delete(authAttempts).where(inArray(authAttempts.key, [
      ...counterKeys, ...[email, throttleEmail, `unknown-${unique}@example.com`, "invalid"].map(value => `email:${digest(value)}`),
    ]));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
