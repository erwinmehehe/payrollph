#!/usr/bin/env node
/**
 * Local-only: build a fresh disposable `app_db` on 127.0.0.1 shaped like the clean-baseline cutover
 * (schema push + drizzle/0109 + reviewed supplement), so tenant proofs can run on a developer
 * machine instead of a 40-minute CI round trip.
 *
 *   node scripts/qa/local-tenant-proof-db.mjs --reset   # park any existing app_db, create a new one
 *   node scripts/qa/local-tenant-proof-db.mjs --restore # drop the disposable app_db, restore the parked one
 *
 * Refuses any host other than 127.0.0.1, any database other than app_db, and never deletes data
 * it did not create: an existing app_db is renamed to app_db_parked_<timestamp>, not dropped.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { hcmWorkItemFixtureSql } from "./prepare-hcm-work-item-fixture.mjs";

const ADMIN = process.env.LOCAL_PG_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const TARGET = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const admin = new URL(ADMIN);
if (admin.hostname !== "127.0.0.1") throw new Error("LOCAL_TENANT_DB_REFUSED: 127.0.0.1 only");
const mode = process.argv.includes("--restore") ? "restore" : process.argv.includes("--reset") ? "reset" : null;
if (!mode) throw new Error("usage: --reset | --restore");

const client = new pg.Client(ADMIN);
await client.connect();
const exists = async (name) => (await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 1;
try {
  if (mode === "restore") {
    const { rows } = await client.query("SELECT datname FROM pg_database WHERE datname LIKE 'app_db_parked_%' ORDER BY datname DESC LIMIT 1");
    if (await exists("app_db")) await client.query("DROP DATABASE app_db WITH (FORCE)");
    if (rows[0]) await client.query(`ALTER DATABASE ${rows[0].datname} RENAME TO app_db`);
    console.log(rows[0] ? "restored " + rows[0].datname + " as app_db" : "dropped disposable app_db (nothing parked)");
  } else {
    if (await exists("app_db")) {
      const parked = "app_db_parked_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      await client.query(`ALTER DATABASE app_db RENAME TO ${parked}`);
      console.log("parked existing app_db as " + parked);
    }
    await client.query("CREATE DATABASE app_db");
  }
} finally {
  await client.end();
}
if (mode === "restore") process.exit(0);

const env = { ...process.env, DATABASE_URL: TARGET };
const push = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push", "--force"], { env, encoding: "utf8" });
if (push.status !== 0 || !/Changes applied/.test(push.stdout + push.stderr)) {
  console.error("schema push failed"); process.exit(1);
}
const db = new pg.Client(TARGET);
await db.connect();
try {
  const { rows: [state] } = await db.query("SELECT (SELECT count(*) FROM organizations)::int AS orgs, to_regclass('public.audit_chain_heads')::text AS heads");
  if (state.orgs !== 0 || state.heads) throw new Error("LOCAL_TENANT_DB_REFUSED: app_db must be freshly pushed and empty");
  for (const file of ["drizzle/0109_tamper_evident_audit_chain.sql", "docs/sql/source-baseline-supplement.sql"]) {
    await db.query("BEGIN");
    try { await db.query(readFileSync(file, "utf8")); await db.query("COMMIT"); }
    catch (error) { await db.query("ROLLBACK"); throw error; }
    console.log("applied " + file);
  }
  // Same SQL-only 0104 work-item objects the shared workflow prepares (hash-verified by its exporter).
  await db.query("BEGIN");
  try { await db.query(hcmWorkItemFixtureSql()); await db.query("COMMIT"); }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  console.log("applied drizzle/0104_hcm_work_item_sla.sql (work-item fixture)");
} finally {
  await db.end();
}
console.log("local disposable app_db ready (push + 0109 + supplement + 0104 work-item fixture)");
