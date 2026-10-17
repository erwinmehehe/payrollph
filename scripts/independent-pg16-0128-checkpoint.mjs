#!/usr/bin/env node
/**
 * Standalone #1127 validation of the proposed #1121 0128 FK-name patch.
 * Uses only atlas_reconciled_db cloned from a disposable 0115-0126 fixture.
 * Rehearses a rollback, then commits ONLY to that synthetic database so that
 * independent Atlas/#1031 readers can inspect post-0128 catalog state.
 * This is NOT the protected real migration runner, history receipt or release.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { parse0128Renames } from "./lib/independent-reconciliation-evidence.mjs";

const WRITER_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const RECONCILED_URL = "postgresql://postgres:postgres@127.0.0.1:5432/atlas_reconciled_db";
const MIGRATION_PATH = "drizzle/0128_recovery_foreign_key_names_forward.sql";
const source = readFileSync(new URL("../" + MIGRATION_PATH, import.meta.url), "utf8");
const mappings = parse0128Renames(source);
assert.equal(mappings.length, 49, "0128 mapping count changed; adjudicate source");

assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE, "isolated-local-pg16");
assert.equal(process.env.DATABASE_URL, WRITER_URL);
assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED, undefined);
assert.equal(new URL(RECONCILED_URL).hostname, "127.0.0.1");

// Strictly require all historical DDL in 0128 to be constraint renames
// following one catalog-only DO preflight. Do not auto-run a revised payload.
const stripped = source.replace(/--[^\r\n]*/g, "");
assert.doesNotMatch(stripped, /^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\s*;/im);
assert.doesNotMatch(stripped, /\b(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|DROP\s+TABLE|CREATE\s+TABLE|ALTER\s+COLUMN|DROP\s+COLUMN)\b/i);

const CATALOG = String.raw`
SELECT c.oid::text AS oid, tbl.relname AS table_name, c.conname AS name,
 c.contype AS type, c.convalidated AS validated,
 c.condeferrable AS deferrable, c.condeferred AS deferred,
 pg_catalog.pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class tbl ON tbl.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.oid
`;
const NON_CONSTRAINT = String.raw`
SELECT
 (SELECT md5(coalesce(string_agg(c.relname || ':' || c.relkind::text,
   '|' ORDER BY c.relname,c.relkind::text),''))
   FROM pg_catalog.pg_class c
   WHERE c.relnamespace='public'::regnamespace
   AND c.relkind IN ('r','p','v','m','i','S')) AS relations,
 (SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' ||
   pg_catalog.format_type(a.atttypid,a.atttypmod), '|'
   ORDER BY c.relname,a.attname),''))
   FROM pg_catalog.pg_attribute a
   JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
   AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 (SELECT md5(coalesce(string_agg(indexname || ':' || indexdef,
   '|' ORDER BY indexname),''))
   FROM pg_catalog.pg_indexes WHERE schemaname='public') AS indexes,
 (SELECT md5(coalesce(string_agg(p.proname || '(' ||
   pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' ||
   pg_catalog.pg_get_functiondef(p.oid),'|'
   ORDER BY p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),''))
   FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace) AS functions
`;
const renamed = new Map(mappings.map(m => [m.table + "." + m.oldName, m.newName]));

function expectedAfter(before) {
  return before.map(row => {
    const fresh = renamed.get(row.table_name + "." + row.name);
    return fresh ? { ...row, name: fresh } : row;
  });
}
async function inspect(db) {
  const constraints = (await db.query(CATALOG)).rows;
  const nonConstraints = (await db.query(NON_CONSTRAINT)).rows[0];
  return { constraints, nonConstraints };
}
function assertOnly49Renames(before, after) {
  assert.equal(before.constraints.length, after.constraints.length);
  assert.deepEqual(after.constraints, expectedAfter(before.constraints),
    "0128 must affect constraint names only, preserving OIDs and semantics");
  assert.deepEqual(after.nonConstraints, before.nonConstraints,
    "0128 must not change index, column, relation or function catalog");
}

const db = new pg.Client({ connectionString: RECONCILED_URL,
  connectionTimeoutMillis: 5000, query_timeout: 180000 });
let transaction = false;
try {
  await db.connect();
  const identity = (await db.query(
    "SELECT current_database() AS db, current_user AS role, " +
    "current_setting('server_version_num')::int AS version, " +
    "pg_is_in_recovery() AS replica"
  )).rows[0];
  assert.equal(identity.db, "atlas_reconciled_db");
  assert.equal(identity.role, "postgres");
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  assert.equal(identity.replica, false);

  await db.query("BEGIN");
  transaction = true;
  await db.query("SET LOCAL lock_timeout='5s'");
  await db.query("SET LOCAL statement_timeout='120s'");
  await db.query("SET LOCAL search_path=public");
  const before = await inspect(db);
  for (const m of mappings) {
    const older = before.constraints.filter(r =>
      r.table_name === m.table && r.name === m.oldName && r.type === "f" && r.validated);
    assert.equal(older.length, 1, "0128 original FK missing/invalid " + m.oldName);
    assert.equal(before.constraints.some(r => r.table_name===m.table &&
      r.name===m.newName), false, "0128 new FK name already exists");
  }

  await db.query("SAVEPOINT independent_0128_rollback");
  await db.query(source);
  const rehearsal = await inspect(db);
  assertOnly49Renames(before, rehearsal);
  await db.query("ROLLBACK TO SAVEPOINT independent_0128_rollback");
  assert.deepEqual(await inspect(db), before, "0128 SAVEPOINT rollback failed");
  await db.query("RELEASE SAVEPOINT independent_0128_rollback");

  await db.query(source);
  assertOnly49Renames(before, await inspect(db));
  await db.query("COMMIT");
  transaction = false;
  console.log(JSON.stringify({
    evidence: "SYNTHETIC_0128_SCHEMA_RENAME_ONLY_NOT_PRODUCTION_RELEASE",
    fixture: "atlas_reconciled_db", parentFixture: "atlas_candidate_db",
    source: MIGRATION_PATH,
    sha256: createHash("sha256").update(source).digest("hex"),
    renamedForeignKeys: mappings.length, checkedEntirePublicConstraintCatalog: true,
    rollbackRehearsed: true, simulatedApplyCommittedInDisposablePG16Only: true,
    original0127ReceiptVerified: false, migrationReceiptCreated: false,
    realProductionAccess: false, approvedForDeployment: false,
    prHeadSha: process.env.PR_HEAD_SHA || null,
    workflowCommitSha: process.env.GITHUB_SHA || null,
  }, null, 2));
} catch (error) {
  if (transaction) await db.query("ROLLBACK").catch(() => {});
  console.error("Independent synthetic 0128 checkpoint BLOCKED: " + error.message);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
