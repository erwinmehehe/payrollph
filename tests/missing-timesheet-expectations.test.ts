import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  expectationStatusForTimesheet,
  payrollRunSupportsTimesheetExpectationAutomation,
} from "../src/lib/workforce-timesheet-expectations";

const read = (path: string) => readFileSync(path, "utf8");

test("expectation lifecycle distinguishes never-submitted from submitted/rejected/stale evidence", () => {
  assert.equal(expectationStatusForTimesheet("approved"), "approved");
  for (const status of ["submitted", "rejected", "stale"]) {
    assert.equal(expectationStatusForTimesheet(status), "submitted");
  }
});

test("only active payroll runs can produce missing-timesheet automation", () => {
  for (const status of ["Draft", "Calculated", "Submitted", "Approved"]) {
    assert.equal(payrollRunSupportsTimesheetExpectationAutomation(status), true, status);
  }
  for (const status of ["Released", "Failed", "Cancelled", "Voided", "Superseded"]) {
    assert.equal(payrollRunSupportsTimesheetExpectationAutomation(status), false, status);
  }
});

test("expectations are frozen from the payroll cohort in the same creation transaction", () => {
  const route = read("src/app/api/payroll-runs/route.ts");
  const expectations = read("src/lib/workforce-timesheet-expectations.ts");
  assert.ok(route.includes("db.transaction(async (tx) => {"));
  assert.ok(route.includes("createTimesheetExpectationsForPayrollRun({"));
  assert.ok(route.includes("employees: employeesInScope.map"));
  assert.ok(route.includes("orgUnitId: employee.orgUnitId"));
  assert.ok(route.includes("enforcementMode: timesheetGate.policy.enforcementMode"));
  assert.ok(expectations.includes("priorTimesheets"));
  assert.ok(expectations.includes("latestByEmployee"));
  assert.ok(expectations.includes('"expectedBy: input.periodEnd"') || expectations.includes("expectedBy: input.periodEnd"));
  assert.ok(expectations.includes(".onConflictDoNothing()"));
});

test("timesheet submission and independent approval reconcile expectation state atomically", () => {
  const route = read("src/app/api/workforce/timesheets/route.ts");
  const expectations = read("src/lib/workforce-timesheet-expectations.ts");
  assert.ok(route.includes("linkTimesheetExpectationsToTimesheet({"));
  assert.ok(route.includes("db.transaction(async (tx) => {"));
  assert.ok(route.includes("timesheetStatus: submitted.status"));
  assert.ok(route.includes("timesheetStatus: decided.status"));
  assert.ok(expectations.includes('status === "approved" ? "approved" : "submitted"'));
  assert.ok(expectations.includes("workforceTimesheetExpectations.version} + 1"));
  assert.ok(expectations.includes("coalesce("));
});

test("scheduler emits versioned source events only while an expectation remains expected", () => {
  const temporal = read("src/lib/automation-temporal-events.ts");
  assert.ok(temporal.includes('eq(workforceTimesheetExpectations.status, "expected")'));
  assert.ok(temporal.includes('notInArray(payrollRuns.status, ["Released", "Failed", "Cancelled", "Voided", "Superseded"])'));
  assert.ok(temporal.includes('trigger: "timesheet.missing_approaching"'));
  assert.ok(temporal.includes('eventKey: `timesheet-missing:${row.expectationId}:${row.expectationVersion}:${bucket}`'));
  assert.ok(temporal.includes('deadlineType: "timesheet_submission"'));
  assert.ok(temporal.includes("timesheetRequirementMode: row.enforcementMode"));
});

test("never-submitted review case re-fetches expectation and payroll state before action", () => {
  const source = read("src/lib/automation-operational-cases.ts");
  assert.ok(source.includes('missing_timesheet_escalation'));
  assert.ok(source.includes('trigger: ["timesheet.missing_approaching"]'));
  assert.ok(source.includes('sourceType: "workforce_timesheet_expectation"'));
  assert.ok(source.includes("workforceTimesheetExpectations.organizationId"));
  assert.ok(source.includes("payrollRunSupportsTimesheetExpectationAutomation(run.status)"));
  assert.ok(source.includes('active: row.status === "expected" && !inactiveRun'));
  assert.ok(source.includes("source.sourceVersion !== input.context.timesheetExpectationVersion"));
  assert.ok(source.includes("source.employeeId !== input.employeeId"));
});

test("schema and migration create new expectations without historical cohort invention", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0097_authoritative_timesheet_expectations.sql");
  const baseline = read("drizzle/baseline.sql");
  const compat = read("src/lib/core-schema-compat.ts");
  for (const file of [schema, migration, baseline, compat]) {
    assert.ok(file.includes("workforce_timesheet_expectations"));
    assert.ok(file.includes("workforce_timesheet_expectation_run_employee_unique"));
    assert.ok(file.includes("workforce_timesheet_expectation_status_check"));
  }
  for (const file of [schema, migration, baseline, compat]) {
    assert.ok(file.includes("missing_timesheet_escalation"));
  }
  assert.ok(migration.includes("Existing payroll runs are intentionally not backfilled"));
  assert.ok(compat.includes("Do not synthesize historical rows for old payroll runs."));
  assert.equal(migration.includes("INSERT INTO workforce_timesheet_expectations"), false);
});

test("product surfaces show authoritative missing state and provide governed escalation template", () => {
  const panel = read("src/components/workspace/workforce-timesheet-panel.tsx");
  const templates = read("src/lib/automation-templates.ts");
  const studio = read("src/components/automation-studio-panel.tsx");
  assert.ok(panel.includes("Expected missing"));
  assert.ok(panel.includes("Expected · not submitted"));
  assert.ok(panel.includes("Not expected / no submission"));
  assert.ok(templates.includes("wfm-never-submitted-timesheet-escalation"));
  assert.ok(templates.includes('trigger: "timesheet.missing_approaching"'));
  assert.ok(templates.includes('caseType: "missing_timesheet_escalation"'));
  assert.ok(studio.includes('"timesheet.missing_approaching": "missing_timesheet_escalation"'));
});
