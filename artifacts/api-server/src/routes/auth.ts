import { Router, type IRouter } from "express";
import { db, accounts, accountSessions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RegisterAccountBody, LoginAccountBody, RegisterAccountResponse, LoginAccountResponse } from "@workspace/api-zod";
import { clearSessionCookie, digest, hashPassword, newSession, normalizeEmail, requireAccount, sessionToken, setSessionCookie, throttle, verifyPassword } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const input = RegisterAccountBody.safeParse({
    ...body,
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    email: typeof body.email === "string" ? normalizeEmail(body.email) : body.email,
  });
  if (!await throttle(req, res, typeof body.email === "string" ? normalizeEmail(body.email) : "invalid")) return;
  const fields: Record<string, string> = {};
  if (!input.success) {
    for (const issue of input.error.issues) {
      const field = String(issue.path[0]);
      fields[field] = field === "name" ? "Enter a name between 1 and 100 characters."
        : field === "email" ? "Enter a valid email address."
        : "Use a password between 12 and 128 characters.";
    }
  }
  if (body.password !== body.passwordConfirmation) fields.passwordConfirmation = "Passwords must match.";
  if (!input.success || Object.keys(fields).length) {
    res.status(400).json({ error: "Please check the highlighted fields.", fields }); return;
  }
  const passwordHash = await hashPassword(input.data.password);
  const session = newSession();
  const oldToken = sessionToken(req);
  const user = await db.transaction(async tx => {
    const [account] = await tx.insert(accounts).values({
      name: input.data.name, email: input.data.email, passwordHash,
    }).onConflictDoNothing({ target: accounts.email }).returning();
    if (!account) return null;
    if (oldToken) await tx.delete(accountSessions).where(eq(accountSessions.tokenHash, digest(oldToken)));
    await tx.insert(accountSessions).values({ accountId: account.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    return RegisterAccountResponse.parse(account);
  });
  if (!user) {
    res.status(409).json({ error: "An account with this email already exists. Please sign in.", fields: { email: "This email is already registered." } }); return;
  }
  setSessionCookie(res, session.token, session.expiresAt);
  res.status(201).json(user);
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (!await throttle(req, res, typeof body.email === "string" ? normalizeEmail(body.email) : "invalid")) return;
  const input = LoginAccountBody.safeParse({ ...body, email: typeof body.email === "string" ? normalizeEmail(body.email) : body.email });
  if (!input.success) {
    res.status(400).json({ error: "Enter a valid email address and password." }); return;
  }
  const [account] = await db.select().from(accounts).where(eq(accounts.email, input.data.email));
  if (!await verifyPassword(input.data.password, account?.passwordHash)) {
    res.status(401).json({ error: "Email or password is incorrect." }); return;
  }
  const session = newSession();
  const oldToken = sessionToken(req);
  await db.transaction(async tx => {
    if (oldToken) await tx.delete(accountSessions).where(eq(accountSessions.tokenHash, digest(oldToken)));
    await tx.insert(accountSessions).values({ accountId: account.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
  });
  setSessionCookie(res, session.token, session.expiresAt);
  res.json(LoginAccountResponse.parse(account));
});

router.get("/auth/me", requireAccount, (_req, res): void => {
  res.json(res.locals.user);
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = sessionToken(req);
  if (token) await db.delete(accountSessions).where(eq(accountSessions.tokenHash, digest(token)));
  clearSessionCookie(res);
  res.sendStatus(204);
});

export default router;
