import pg from "pg";
import { readFile } from "node:fs/promises";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to apply the database schema.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(7218492)");
  for (const migration of ["0000_procurement.sql", "0001_accounts.sql", "0003_remove_tools_secrets.sql"]) {
    await client.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  await client.query("COMMIT");
  console.log("Procurement and account schemas are ready; legacy Tools secret storage is removed.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Database schema migration failed.", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
