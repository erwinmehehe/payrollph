#!/usr/bin/env node
/**
 * Independent third-party Atlas cross-check fixture for #1031 and #1121.
 *
 * ONLY an uncredentialed GitHub Actions job with the exact local PG16 URLs is
 * allowed. The source app_db is created by a single guarded drizzle-kit push;
 * atlas_candidate_db is copied from app_db and mutated only in this disposable
 * service. Atlas subsequently compares the two databases with read-only CLI.
 *
 * No historical receipts, production baseline adoption, or release permission.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  ISSUE1054_PREFLIGHT_SQL,
  ISSUE1054_POSTFLIGHT_SQL,
} from "./lib/issue-1054-protected-preflight.mjs";

const SOURCE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const CANDIDATE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/atlas_candidate_db";
const FILES = Object.freeze([
  "0115_payout_profiles_foundation.sql",
  "0116_payout_ledger_foundation.sql",
  "0117_inline_first_payroll_journey.sql",
  "0118_wfm_roster_scale_rules.sql",
  "0119_xendit_payout_provider.sql",
  "0120_wfm_punch_evidence.sql",
  "0121_multi_entity_v2_scope_transfer.sql",
  "0122_tenant_module_disclosure.sql",
  "0123_multi_entity_forward_schema_repair.sql",
  "0124_attendance_exception_forward_repair.sql",
  "0125_wfm_availability_open_shifts_forward_repair.sql",
  "0126_compensation_governance_forward_repair.sql",
]);
const ABSENT_TARGETS = Object.freeze([
  "payout_batch_transfers", "payout_transfers", "payout_batches", "payout_profiles",
  "provider_events", "workforce_demand_import_batches",
  "workforce_demand_observation_revisions", "workforce_demand_forecast_issues",
  "workforce_demand_forecast_scores", "workforce_demand_staffing_policies",
  "workforce_demand_staffing_policy_events",
  "entity_transfer_requests", "employee_entity_assignments",
  "user_entity_preferences", "user_legal_entity_grants",
  "attendance_exception_events", "employee_availability_rules", "open_shifts",
  "open_shift_claims", "compensation_bands", "compensation_cycles",
  "compensation_proposals", "compensation_components",
  "employee_compensation_components", "compensation_events",
]);

function failClosedEnvironment() {
  assert.equal(process.env.CI, "true", "CI only");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "GitHub Actions only");
  assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE, "isolated-local-pg16", "local PG16 mode required");
  assert.equal(process.env.DATABASE_URL, SOURCE_URL, "external or alternate DATABASE_URL forbidden");
  assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined, "production credentials forbidden");
  assert.equal(process.env.DATABASE_URL_UNPOOLED, undefined, "Neon direct credentials forbidden");
}

function loadSql(file) {
  const content = readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8");
  assert.ok(content.length > 200, "truncated SQL: " + file);
  return content;
}

async function main() {
  failClosedEnvironment();
  const client = new pg.Client({ connectionString: CANDIDATE_URL, connectionTimeoutMillis: 5000, query_timeout: 180000 });
  await client.connect();
  let transaction = false;
  try {
    const identity = (await client.query(
      "SELECT current_database() AS db, inet_server_addr()::text AS host, " +
      "current_setting('server_version_num')::integer AS version, " +
      "current_setting('transaction_read_only') AS readonly"
    )).rows[0];
    assert.equal(identity.db, "atlas_candidate_db");
    assert.equal(identity.host, "127.0.0.1");
    assert.ok(identity.version >= 160000 && identity.version < 170000, "PG16 only");
    assert.equal(identity.readonly, "off");

    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL search_path = public");

    // Simulates the known *absences* in a synthetic production-shaped baseline.
    // Does not pretend to recreate a production DB or historical receipts.
    // CASCADE can remove other synthetic foreign keys; Atlas should surface
    // them as differences, not auto-normalize them away.
    await client.query("DROP TABLE IF EXISTS " +
      ABSENT_TARGETS.map(name => 'public."' + name + '"').join(", ") + " CASCADE");

    for (const name of ABSENT_TARGETS) {
      const row = (await client.query("SELECT to_regclass($1) AS target", ["public." + name])).rows[0];
      assert.equal(row.target, null, "baseline object still present: " + name);
    }
    for (const file of FILES) {
      const sql = loadSql(file);
      if (file.startsWith("0125_")) await client.query(ISSUE1054_PREFLIGHT_SQL);
      await client.query(sql);
      if (file.startsWith("0125_")) await client.query(ISSUE1054_POSTFLIGHT_SQL);
    }
    for (const name of ABSENT_TARGETS) {
      const row = (await client.query("SELECT to_regclass($1) IS NOT NULL AS target", ["public." + name])).rows[0];
      assert.equal(row.target, true, "post-train object absent: " + name);
    }
    // The third-party CLI needs committed visibility. COMMIT is allowed ONLY
    // on atlas_candidate_db inside the throwaway GitHub Actions PG16 service.
    await client.query("COMMIT");
    transaction = false;

    console.log(JSON.stringify({
      evidence: "SYNTHETIC_LOCAL_PG16_ONLY_NOT_PRODUCTION_PARITY",
      baseline: "single Drizzle push in app_db; candidate cloned then target tables removed",
      candidate: "atlas_candidate_db",
      orderedSourcePaths: FILES.map(file => "drizzle/" + file),
      orderedSourceSha256: FILES.map(file => ({
        path: "drizzle/" + file,
        sha256: createHash("sha256").update(loadSql(file)).digest("hex"),
      })),
      migrationReceiptCreated: false,
      productionDatabaseAccessed: false,
      releaseApproved: false,
    }, null, 2));
  } finally {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.error("Independent synthetic fixture failed closed: " + (error?.message || "unknown"));
  process.exitCode = 1;
});
