import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, index, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("accounts_email_normalized", sql`${table.email} = lower(trim(${table.email}))`)]);
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true });
export type Account = typeof accounts.$inferSelect;

export const accountSessions = pgTable("account_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("account_sessions_expiry_idx").on(table.expiresAt)]);
export const insertAccountSessionSchema = createInsertSchema(accountSessions);
export type AccountSession = typeof accountSessions.$inferSelect;

// Fixed-window counters are shared across workers and survive server restarts.
export const authAttempts = pgTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_attempts_reset_idx").on(table.resetsAt)]);
export const insertAuthAttemptSchema = createInsertSchema(authAttempts);
export type AuthAttempt = typeof authAttempts.$inferSelect;
