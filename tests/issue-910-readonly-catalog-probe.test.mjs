import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural safety of the DBA's manually executable query. This test never
// opens a database connection and cannot confer execution permission.
const sql = readFileSync(
  new URL("../docs/sql/issue-910-read-only-catalog-probe.sql", import.meta.url), "utf8",
);
const clean = sql.replace(/--[^\n]*/g, "");
const expected = [
  "job_profiles", "workforce_plans", "positions", "position_assignments",
  "worker_employment_events", "job_families", "job_levels", "job_grades",
  "worker_effective_changes", "provider_events",
  "workforce_demand_import_batches", "workforce_demand_observation_revisions",
  "workforce_demand_forecast_issues", "workforce_demand_forecast_scores",
  "workforce_demand_staffing_policies", "workforce_demand_staffing_policy_events",
  "payout_profiles", "payout_batches", "payout_transfers",
  "workforce_punch_photo_evidence", "workforce_punch_submissions",
  "user_legal_entity_grants", "employee_entity_assignments",
  "entity_transfer_requests", "legal_entity_profile_change_requests",
  "legal_entity_statutory_registrations",
];

test("#910 query is a single read-only SELECT including CTEs, never an executor", () => {
  assert.match(clean, /^\s*WITH\s+expected\(/i);
  assert.match(clean, /\bSELECT\b/i);
  assert.equal(clean.trim().split(";").filter(Boolean).length, 1);
  assert.doesNotMatch(clean, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|CALL|GRANT|REVOKE|COPY|DO|PERFORM|VACUUM|REINDEX|LOCK|EXECUTE)\b/i);
  assert.doesNotMatch(clean, /pg_sleep|dblink|set_config|pg_advisory|pg_notify|lo_export/i);
  assert.match(clean, /execution_status.*'UNPROVEN'/s);
  assert.match(clean, /pg_catalog\.pg_class/);
});

test("#910 query inventories exact 26 objects and cannot silently narrow prerequisite coverage", () => {
  const pairs = [...clean.matchAll(/\('(\d{4}|registration)','([a-z_]+)'\)/g)]
    .map(match => match[2]);
  assert.equal(pairs.length, expected.length);
  assert.equal(new Set(pairs).size, expected.length);
  assert.deepEqual(pairs.sort(), expected.sort());
  assert.match(clean, /to_regclass\(format\('public\.%I', table_name\)\)/);
  assert.match(clean, /migration_name_match_count/);
  assert.match(clean, /workforce_plans_indexes/);
  assert.match(clean, /ess_drift_tables/);
});
