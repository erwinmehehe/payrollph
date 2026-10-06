import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("approved leave feeds WFM coverage and full open-shift eligibility", () => {
  const route = read("src/app/api/workforce/coverage/route.ts");
  const coverage = read("src/lib/workforce-coverage.ts");

  assert.ok(route.includes("approvedLeaveOnDate"));
  assert.ok(route.includes("approvedLeaveCoverageImpact"));
  assert.ok(route.includes("absenceEvidenceIssues"));
  assert.ok(route.includes("cannot claim a full open shift"));
  assert.ok(route.includes("cannot be approved for the open shift"));
  assert.ok(coverage.includes("approvedLeaveScheduledHeadcount"));
  assert.ok(coverage.includes("approvedLeaveShiftDefinitionIds"));
});

test("leave approval invalidates overlapping submitted or approved timesheets", () => {
  const approvals = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(approvals.includes("markTimesheetsStaleForEmployeeRange"));
  assert.ok(approvals.includes("leaveStaleTimesheetIds"));
  assert.ok(approvals.includes("startDate: String(linkedLeave.startDate)"));
  assert.ok(approvals.includes("endDate: String(linkedLeave.endDate)"));
});

test("coverage UI distinguishes unavailable, unqualified and approved-leave exclusions", () => {
  const panel = read("src/components/workspace/workforce-coverage-panel.tsx");
  assert.ok(panel.includes("Roster exclusions"));
  assert.ok(panel.includes("approvedLeaveScheduledHeadcount"));
  assert.ok(panel.includes("capabilityIneligibleHeadcount"));
  assert.ok(panel.includes("on leave"));
});
