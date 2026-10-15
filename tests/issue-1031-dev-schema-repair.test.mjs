import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This is a source check. Real PostgreSQL 18 rehearsal was performed on a
// named isolated Neon branch and is separately documented in issue #1031.
const sql = readFileSync("docs/sql/issue-1031-dev-workforce-bi-repair.sql", "utf8");
const executable = sql.replace(/--[^\n]*/g, "");

test("issue 1031 forward source is additive, no demo/payroll data rewrites", () => {
  assert.match(executable, /ISSUE_1031_INCOMPATIBLE_BASE_SCHEMA/);
  assert.match(executable, /ISSUE_1031_PARTIAL_OR_PREVIOUS_REPAIR_REQUIRES_REVIEW/);
  assert.doesNotMatch(executable, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  assert.doesNotMatch(executable, /\b(?:GRANT|REVOKE|DISABLE TRIGGER|CASCADE\s*;)\b/i);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS/);
});

test("permission overlay uses constrained and deny-only assignments", () => {
  for (const rel of ["dynamic_worker_groups", "permission_sets", "user_permission_assignments"]) {
    assert.ok(executable.includes(`CREATE TABLE IF NOT EXISTS "${rel}"`), rel);
  }
  assert.match(executable, /user_permission_assignments_group_pair_check/);
  assert.match(executable, /user_permission_assignments_membership_unique/);
  assert.match(executable, /user_permission_assignments_group_idx/);
  assert.doesNotMatch(executable, /INSERT INTO\s+"user_permission_assignments"/i);
});

test("HCM, recruitment and timesheet schema dependencies are represented", () => {
  for (const rel of [
    "job_families", "job_levels", "job_grades", "job_profiles",
    "positions", "position_assignments", "workforce_timesheets",
  ]) assert.ok(executable.includes(`CREATE TABLE IF NOT EXISTS "${rel}"`), rel);
  for (const name of [
    "position_assignments_active_primary_employee_unique",
    "position_assignments_active_position_unique",
    "job_requisitions_active_position_unique",
    "workforce_timesheet_period_version_unique",
    "plan_handoff_evidence", "role_skill_snapshot", "assignment_type",
  ]) assert.ok(executable.includes(name), name);
});
