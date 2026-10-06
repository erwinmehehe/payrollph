import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/workforce/timesheets/route.ts", "utf8");
const server = readFileSync("src/lib/workforce-timesheet-server.ts", "utf8");
const payrollCreate = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
const payrollProcess = readFileSync("src/app/api/payroll-runs/[id]/process/route.ts", "utf8");
const corrections = readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
const schedules = readFileSync("src/app/api/workforce/schedules/route.ts", "utf8");
const swaps = readFileSync("src/app/api/workforce/schedule-swaps/route.ts", "utf8");
const overtime = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
const coverage = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/workforce-timesheet-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("timesheet approvals use versioned immutable evidence", () => {
  assert.ok(schema.includes('export const workforceTimesheets = pgTable('));
  assert.ok(schema.includes('version: integer("version")'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
  assert.ok(schema.includes('uniqueIndex("workforce_timesheet_period_version_unique")'));
  assert.ok(route.includes("version = (existing[0]?.version ?? 0) + 1") || route.includes("const version = (existing[0]?.version ?? 0) + 1"));
});

test("employee may submit own timesheet but submitter cannot self-approve", () => {
  assert.ok(route.includes("const selfService = user.employeeId === employeeId"));
  assert.ok(route.includes("A timesheet submitter cannot approve their own submitted version."));
});

test("approval re-hashes live evidence and stales changed submissions", () => {
  assert.ok(route.includes("current.snapshotHash !== timesheet.snapshotHash"));
  assert.ok(route.includes('status: "stale"'));
  assert.ok(route.includes("TIMESHEET_EVIDENCE_CHANGED"));
  assert.ok(route.includes("TIMESHEET_BLOCKERS"));
});

test("approved leave prevents false missing-punch blocker while unresolved corrections remain blockers", () => {
  assert.ok(server.includes("dateCoveredByApprovedLeave"));
  assert.ok(server.includes('exception.kind !== "missing_punch"'));
  assert.ok(server.includes("attendance correction request(s)"));
});

test("blocking mode gates both payroll creation processing and recalculation", () => {
  assert.ok(payrollCreate.includes("loadTimesheetPayrollGate"));
  assert.ok(payrollCreate.includes("TIMESHEET_APPROVAL_REQUIRED"));
  assert.ok(payrollCreate.includes("if (processNow && !timesheetGate.gate.allowed)"));
  assert.ok(payrollProcess.includes("loadTimesheetPayrollGate"));
  assert.ok(payrollProcess.includes("TIMESHEET_APPROVAL_REQUIRED"));
});

test("all workforce evidence mutations stale overlapping submitted or approved timesheets", () => {
  assert.ok(corrections.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(schedules.includes("markTimesheetsStaleForEmployeeRange"));
  assert.ok(schedules.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(swaps.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(overtime.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(coverage.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(server.includes('inArray(workforceTimesheets.status, ["submitted", "approved"])'));
});

test("timesheet payroll gate defaults to advisory for backward compatibility", () => {
  assert.ok(server.includes('return { active: true, enforcementMode: "advisory" }'));
  assert.ok(schema.includes('enforcementMode: varchar("enforcement_mode"'));
});

test("timesheet finalization UI is part of the main WFM planner", () => {
  assert.ok(panel.includes("Approve the time payroll will consume."));
  assert.ok(panel.includes("Require approved timesheets"));
  assert.ok(panel.includes("stale"));
  assert.ok(planner.includes("<WorkforceTimesheetPanel"));
});
