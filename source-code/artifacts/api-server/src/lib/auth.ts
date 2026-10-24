import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, CookieOptions } from "express";
import { db, accounts, accountSessions, authAttempts } from "@workspace/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { GetCurrentUserResponse } from "@workspace/api-zod";

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, SCRYPT, (error, key) => error ? reject(error) : resolve(key));
});
export const SESSION_COOKIE = "procureflow_session";
export const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt-v1$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  // Unknown accounts incur the same expensive derivation as known accounts.
  const [, salt, expected] = (stored ?? `scrypt-v1$${"0".repeat(32)}$${"0".repeat(128)}`).split("$");
  const key = await derive(password, salt);
  const target = Buffer.from(expected, "hex");
  return target.length === key.length && timingSafeEqual(key, target) && stored !== undefined;
}

export function cookieOptions(): CookieOptions {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
}

export function sessionToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function requireAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = sessionToken(req);
  if (token) {
    const [user] = await db.select({ id: accounts.id, name: accounts.name, email: accounts.email })
      .from(accountSessions).innerJoin(accounts, eq(accounts.id, accountSessions.accountId))
      .where(and(eq(accountSessions.tokenHash, digest(token)), gt(accountSessions.expiresAt, new Date())));
    if (user) {
      res.locals.user = GetCurrentUserResponse.parse(user);
      next();
      return;
    }
  }
  clearSessionCookie(res);
  res.status(401).json({ error: "Please sign in to access the workspace." });
}

// Browsers cannot add this non-simple header cross-origin without a successful
// CORS preflight. No CORS permission is issued. Origin and Fetch Metadata are
// checked as an additional defense (including against same-site sibling hosts).
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  const host = req.get("x-forwarded-host") ?? req.get("host");
  let validOrigin = true;
  if (origin) {
    try {
      const parsed = new URL(origin);
      validOrigin = ["https:", "http:"].includes(parsed.protocol) && parsed.host === host;
    } catch { validOrigin = false; }
  }
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!validOrigin || req.get("sec-fetch-site") === "cross-site" ||
    (mutation && (req.get("x-procureflow-request") !== "1" ||
      (req.method !== "DELETE" && !req.is("application/json"))))) {
    res.status(403).json({ error: "This request could not be verified. Refresh the page and try again." });
    return;
  }
  next();
}

export async function throttle(req: Request, res: Response, email: string): Promise<boolean> {
  const now = new Date();
  // Hash both identifiers; neither email addresses nor raw network addresses
  // are retained in the rate-limit table.
  const keys = [
    { key: `ip:${digest(req.ip ?? "unknown")}`, limit: 40 },
    { key: `email:${digest(email)}`, limit: 10 },
  ];
  for (const { key, limit } of keys) {
    const [counter] = await db.insert(authAttempts).values({ key, count: 1, resetsAt: new Date(+now + WINDOW) })
      .onConflictDoUpdate({ target: authAttempts.key, set: {
        count: sql`case when ${authAttempts.resetsAt} <= ${now} then 1 else ${authAttempts.count} + 1 end`,
        resetsAt: sql`case when ${authAttempts.resetsAt} <= ${now} then ${new Date(+now + WINDOW)} else ${authAttempts.resetsAt} end`,
      } }).returning();
    if (counter.count > limit) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((+counter.resetsAt - +now) / 1000))));
      res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." });
      return false;
    }
  }
  await db.delete(authAttempts).where(lt(authAttempts.resetsAt, now));
  await db.delete(accountSessions).where(lt(accountSessions.expiresAt, now));
  return true;
}

export function newSession() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: digest(token), expiresAt: new Date(Date.now() + SESSION_LIFETIME) };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt, maxAge: SESSION_LIFETIME });
}
