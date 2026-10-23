import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

// An isolated search_path models a completely empty application database without
// requiring CREATEDB privileges or touching any existing user tables.
const schema = `bootstrap_test_${randomUUID().replaceAll("-", "")}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const baseline = await pool.query("SELECT * FROM procurement_records ORDER BY id");
const baselineAccounts = await pool.query("SELECT * FROM accounts ORDER BY id");
const baselineSessions = await pool.query("SELECT * FROM account_sessions ORDER BY token_hash");
let processHandle;
let base;
const env = { ...process.env, PGOPTIONS: `-c search_path=${schema}`, NODE_ENV: "production", LOG_LEVEL: "info" };

async function migrate(environment) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./migrate.mjs", import.meta.url))], {
    env: environment, stdio: "ignore",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Forward migrations must run without interaction");
}

async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = once(processHandle, "exit");
  processHandle.kill("SIGTERM");
  await exited;
  processHandle = undefined;
}

async function start() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}/api`;
  processHandle = spawn(process.execPath, [fileURLToPath(new URL("../../../artifacts/api-server/dist/index.mjs", import.meta.url))], {
    env: { ...env, PORT: String(port) }, stdio: "ignore",
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error("Isolated API process failed to start");
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* Startup is still in progress. */ }
    await delay(50);
  }
  throw new Error("Isolated API process did not become healthy");
}

async function request(path, { data, cookie, method } = {}) {
  return fetch(`${base}${path}`, {
    method: method ?? (data === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-ProcureFlow-Request": "1", ...(cookie ? { cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

async function assertLegacyTablesGone(client) {
  const result = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename IN ('tools_secrets', 'tools_secret_events') ORDER BY tablename",
  );
  assert.deepEqual(result.rows, [], "Legacy Tools secret and audit tables are removed");
}

try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const isolated = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    const initial = await isolated.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
    assert.equal(initial.rowCount, 0, "Bootstrap starts without application tables");
    await migrate(env);
    await migrate(env); // Repeat setup against a populated schema without dropping records.
    await assertLegacyTablesGone(isolated);
    await start();
    assert.equal((await request("/procurement/requests")).status, 401);
    assert.equal((await request("/tools/capabilities")).status, 404);
    assert.equal((await request("/tools/secrets")).status, 404);
    const signup = await request("/auth/register", { data: {
      name: "Bootstrap Test", email: "bootstrap-test@example.com",
      password: "bootstrap-only-passphrase-582", passwordConfirmation: "bootstrap-only-passphrase-582",
    } });
    assert.equal(signup.status, 201, "Signup works after empty-schema bootstrap");
    const cookie = signup.headers.get("set-cookie").split(";")[0];
    const account = await signup.json();
    const list = await request("/procurement/requests", { cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), []);
    for (const path of ["/procurement/dashboard", "/procurement/invoices", "/procurement/recommendations"]) {
      assert.equal((await request(path, { cookie })).status, 200);
    }
    const created = await request("/procurement/requests", { cookie, data: {
      itemName: "Isolated bootstrap test item", quantity: 2, budgetAmount: 500, currency: "MYR",
      requiredDeliveryDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      deliveryLocation: "Kuala Lumpur", requesterName: "Bootstrap Buyer",
    } });
    assert.equal(created.status, 201);
    const record = await created.json();
    assert.equal(record.offers.length, 4);
    const decision = await request(`/procurement/requests/${record.id}/decision`, { cookie, data: {
      decision: "approved", managerName: "Self-entered Test Manager", offerId: record.offers[0].id,
    } });
    assert.equal(decision.status, 200);
    assert.ok((await decision.json()).invoice);

    await stop();
    // Recreate the historical schema and sample rows in isolation to prove the
    // new forward migration erases them without changing account/procurement data.
    await isolated.query(await readFile(new URL("../migrations/0002_tools_secrets.sql", import.meta.url), "utf8"));
    await isolated.query(
      "INSERT INTO tools_secrets (name, encrypted_value, updated_by) VALUES ($1, $2, $3)",
      ["LEGACY_BOOTSTRAP_TEST", "synthetic-ciphertext", account.id],
    );
    await isolated.query(
      "INSERT INTO tools_secret_events (secret_name, action, actor_id) VALUES ($1, $2, $3)",
      ["LEGACY_BOOTSTRAP_TEST", "create", account.id],
    );
    assert.equal((await isolated.query("SELECT count(*) FROM tools_secrets")).rows[0].count, "1");
    assert.equal((await isolated.query("SELECT count(*) FROM tools_secret_events")).rows[0].count, "1");
    const accountRowsBeforeRemoval = await isolated.query("SELECT * FROM accounts ORDER BY id");
    const sessionRowsBeforeRemoval = await isolated.query("SELECT * FROM account_sessions ORDER BY token_hash");
    const procurementRowsBeforeRemoval = await isolated.query("SELECT * FROM procurement_records ORDER BY id");
    await migrate(env);
    await assertLegacyTablesGone(isolated);
    assert.deepEqual((await isolated.query("SELECT * FROM accounts ORDER BY id")).rows, accountRowsBeforeRemoval.rows);
    assert.deepEqual((await isolated.query("SELECT * FROM account_sessions ORDER BY token_hash")).rows, sessionRowsBeforeRemoval.rows);
    assert.deepEqual((await isolated.query("SELECT * FROM procurement_records ORDER BY id")).rows, procurementRowsBeforeRemoval.rows);
    await migrate(env); // The drop remains safe on subsequent setup runs.
    await assertLegacyTablesGone(isolated);
    assert.deepEqual((await isolated.query("SELECT * FROM accounts ORDER BY id")).rows, accountRowsBeforeRemoval.rows);
    assert.deepEqual((await isolated.query("SELECT * FROM procurement_records ORDER BY id")).rows, procurementRowsBeforeRemoval.rows);
    await start();
    assert.equal((await request("/auth/me", { cookie })).status, 200, "Persistent session survives process restart");
    assert.equal((await request("/tools/capabilities", { cookie })).status, 404);
    assert.equal((await request("/tools/secrets", { cookie })).status, 404);
    const reloaded = await request("/procurement/requests", { cookie });
    assert.equal(reloaded.status, 200);
    const records = await reloaded.json();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, record.id);
    assert.equal(records[0].status, "approved");
    const invoices = await request("/procurement/invoices", { cookie });
    assert.equal((await invoices.json()).length, 1);
    assert.equal((await request("/auth/logout", { method: "POST", cookie })).status, 204);
    assert.equal((await request("/procurement/requests", { cookie })).status, 401);
  } finally { await isolated.end(); }

  // Re-run the exact setup on the existing workspace and prove its account and
  // procurement records remain unchanged.
  await migrate(process.env);
  const liveLegacyTables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename IN ('tools_secrets', 'tools_secret_events') ORDER BY tablename",
  );
  assert.deepEqual(liveLegacyTables.rows, [], "Current database no longer has legacy secret storage");
  assert.deepEqual((await pool.query("SELECT * FROM procurement_records ORDER BY id")).rows, baseline.rows);
  assert.deepEqual((await pool.query("SELECT * FROM accounts ORDER BY id")).rows, baselineAccounts.rows);
  assert.deepEqual((await pool.query("SELECT * FROM account_sessions ORDER BY token_hash")).rows, baselineSessions.rows);
  console.log("PASS: empty-schema bootstrap, legacy table removal, signup, procurement creation/approval/invoice, process restart, logout, and existing account/procurement preservation.");
} finally {
  await stop();
  // Only this randomly named test schema is removed, never the user's schema.
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
