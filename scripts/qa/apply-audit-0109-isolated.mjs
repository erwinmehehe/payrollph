import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

// This runner is intentionally limited to a new GitHub Actions PostgreSQL 16
// service. It is NOT the application migration runner or a production command.
const expectedUrl = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
assert.equal(process.env.GITHUB_ACTIONS, "true", "GitHub Actions isolation is required");
assert.equal(process.env.CI, "true", "CI isolation is required");
assert.equal(process.env.DATABASE_URL, expectedUrl, "Only the disposable CI database is permitted");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");

const client = new pg.Client({ connectionString: expectedUrl });
try {
  await client.connect();
  const { rows: [server] } = await client.query(`
    SELECT current_database() AS database_name,
      current_setting('server_version_num')::integer AS version_num,
      current_setting('server_encoding') AS encoding,
      to_regclass('public.audit_events')::text AS audit_table,
      to_regclass('public.organizations')::text AS organization_table
  `);
  assert.equal(server.database_name, "app_db");
  assert.ok(server.version_num >= 160000 && server.version_num < 170000, "Must be PostgreSQL 16");
  assert.equal(server.encoding, "UTF8", "UTF-8 is mandatory for Philippine payroll trace");
  assert.equal(server.audit_table, "audit_events");
  assert.equal(server.organization_table, "organizations");

  const { rows: [counts] } = await client.query(`
    SELECT (SELECT count(*) FROM organizations)::integer AS organizations,
      (SELECT count(*) FROM audit_events)::integer AS audit_events
  `);
  assert.equal(counts.organizations, 0, "Refusing migration against a nonempty employer database");
  assert.equal(counts.audit_events, 0, "Refusing migration against a populated audit trail");

  const sql = readFileSync("drizzle/0109_tamper_evident_audit_chain.sql", "utf8");
  await client.query(sql);
  const { rows: [trigger] } = await client.query(`
    SELECT t.tgenabled, p.proname
    FROM pg_trigger AS t
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.audit_events'::regclass
      AND t.tgname = 'audit_events_protect_mutation'
      AND NOT t.tgisinternal
  `);
  assert.equal(trigger?.tgenabled, "O", "Append-only trigger must be enabled");
  assert.equal(trigger?.proname, "audit_events_protect");
  const { rows: [heads] } = await client.query(
    "SELECT to_regclass('public.audit_chain_heads')::text AS name",
  );
  assert.equal(heads?.name, "audit_chain_heads");
  process.stdout.write(JSON.stringify({
    kind: "isolated-ci-schema-proof",
    externalAcceptance: false,
    databaseEngine: "PostgreSQL 16",
    encoding: server.encoding,
    migration: "0109_tamper_evident_audit_chain.sql",
    migrationSha256: createHash("sha256").update(sql).digest("hex"),
    auditTriggerEnabled: true,
    startEmployerCount: counts.organizations,
    startAuditEventCount: counts.audit_events,
  }, null, 2) + "\n");
} finally {
  await client.end();
}
