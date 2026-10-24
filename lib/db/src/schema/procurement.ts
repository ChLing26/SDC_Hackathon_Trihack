import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const procurementRecords = pgTable("procurement_records", {
  id: serial("id").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertProcurementRecordSchema = createInsertSchema(procurementRecords).omit({ id: true, createdAt: true });
export type ProcurementRecord = typeof procurementRecords.$inferSelect;
