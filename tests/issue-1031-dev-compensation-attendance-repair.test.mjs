import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This is a source check for the stage-3 dev-only repair. Real PostgreSQL 16
// rehearsal was performed locally against a disposable embedded-postgres
// instance (not Neon): full current schema.ts pushed, the 7 target tables
// dropped to simulate the still-absent state documented in
// docs/engineering/issue-1031-schema-drift-remediation.md, the repair SQL
// applied, then a second `drizzle-kit push` confirmed zero further column,
// FK, nullability or index drift against the live Drizzle schema. Any real
// application to the connected Neon dev branch remains separately gated,
// exactly like stage 1 and 2, and is not performed by this test.
const sql = readFileSync("docs/sql/issue-1031-dev-compensation-attendance-payout-repair.sql", "utf8");
const executable = sql.replace(/--[^\n]*/g, "");

test("issue 1031 stage 3 forward source is additive, no demo/payroll data rewrites", () => {
  assert.match(executable, /ISSUE_1031_STAGE3_BASE_DEPENDENCY_MISSING/);
  assert.match(executable, /ISSUE_1031_STAGE3_ALREADY_OR_PARTIALLY_REPAIRED/);
  assert.doesNotMatch(executable, /\b(?:DROP\s+(?:TABLE|INDEX)|TRUNCATE\s+|DELETE\s+FROM|UPDATE\s+|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(executable, /\b(?:GRANT|REVOKE|DISABLE TRIGGER|CASCADE\s*;)\b/i);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS/);
});

test("compensation governance, attendance exception and payout dual-control tables are represented", () => {
  for (const rel of [
    "compensation_bands", "compensation_cycles", "compensation_proposals",
    "compensation_components", "employee_compensation_components",
    "attendance_exception_events", "employee_payout_change_requests",
  ]) assert.ok(executable.includes(`CREATE TABLE IF NOT EXISTS "${rel}"`), rel);
  // compensation_events already exists per the verified "still absent" list
  // and must never be recreated here.
  assert.doesNotMatch(executable, /CREATE TABLE IF NOT EXISTS "compensation_events"/);
});

test("named constraints and the current-schema final shape are present, not the superseded historical shape", () => {
  for (const name of [
    "compensation_bands_org_scope_effective_unique", // post-0054 shape, not the 0042 original
    "compensation_proposals_cycle_employee_unique",
    "employee_payout_change_requests_open_employee_unique",
    "attendance_exception_events_fingerprint_unique",
    "attendance_exception_events_owner_idx", // added by 0088, not 0067
    "attendance_exception_events_sla_idx",
  ]) assert.ok(executable.includes(name), name);
  // The 0042-era column-required FK and the pre-0054 index name must not
  // reappear: this file defines the final shape directly, it does not
  // replay the superseded intermediate migration.
  assert.doesNotMatch(executable, /compensation_bands_org_profile_location_unique/);
  assert.match(executable, /"job_profile_id" integer REFERENCES "job_profiles"\("id"\) ON DELETE restrict,\s*\n\s*"grade_id"/);
});

test("the guard checks every FK-target dependency this stage actually needs", () => {
  for (const dependency of [
    "public.time_punches", "public.job_profiles", "public.job_grades",
    "public.legal_entities", "public.employee_pay_revisions",
    "public.worker_effective_changes",
  ]) assert.ok(executable.includes(dependency), dependency);
});
