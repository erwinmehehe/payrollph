import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluatePayrollConnectedRelease } from "../src/lib/payroll-connected-release-gate";

const calculationStartedAt = "2026-10-16T08:00:00.000Z";
const input = () => ({
  periodStart: "2026-10-01",
  periodEnd: "2026-10-15",
  calculationStartedAt,
  calculatedEmployeeIds: [1, 2],
  expectedEmployeeIds: [1, 2],
});

test("clean matched population and completed calculation permits connected gate", () => {
  const original = input();
  const result = evaluatePayrollConnectedRelease(original);
  assert.equal(result.ready, true);
  assert.equal(result.blockingCount, 0);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.version, "connected-payroll-release-v1");
  assert.deepEqual(original.calculatedEmployeeIds, [1, 2]);
});

test("missing/extra/duplicated employees and missing calculation receipt fail closed", () => {
  const coverage = evaluatePayrollConnectedRelease({
    ...input(),
    expectedEmployeeIds: [1, 2, 3],
    calculatedEmployeeIds: [1, 2, 4],
  });
  assert.equal(coverage.ready, false);
  assert.deepEqual(new Set(coverage.findings.map((f) => f.code)), new Set([
    "PAYROLL_ELIGIBLE_EMPLOYEE_MISSING", "PAYROLL_INELIGIBLE_EMPLOYEE_INCLUDED",
  ]));
  const duplicate = evaluatePayrollConnectedRelease({ ...input(), calculatedEmployeeIds: [1, 1, 2] });
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.findings.some((f) => f.code === "PAYROLL_POPULATION_INVALID"));
  const noTimestamp = evaluatePayrollConnectedRelease({ ...input(), calculationStartedAt: null });
  assert.equal(noTimestamp.ready, false);
  assert.ok(noTimestamp.findings.some((f) => f.code === "PAYROLL_CALCULATION_TIME_MISSING"));
});

test("scheduled worker changes block but finalized changes before calculation do not", () => {
  const result = evaluatePayrollConnectedRelease({
    ...input(),
    workerChanges: [
      { id: 1, employeeId: 1, status: "scheduled", effectiveDate: "2026-10-12", appliedAt: null },
      { id: 2, employeeId: 2, status: "applied", effectiveDate: "2026-10-10", appliedAt: "2026-10-16T07:00:00Z" },
      { id: 3, employeeId: 2, status: "applied", effectiveDate: "2026-10-11", appliedAt: "2026-10-16T09:00:00Z" },
      { id: 4, employeeId: 1, status: "pending_approval", effectiveDate: "2026-11-01", appliedAt: null },
      { id: 5, employeeId: 9, status: "scheduled", effectiveDate: "2026-10-12", appliedAt: null },
    ],
  });
  assert.deepEqual(new Set(result.findings.map((f) => f.code)), new Set([
    "HRIS_EFFECTIVE_CHANGE_NOT_APPLIED", "HRIS_CHANGE_AFTER_CALCULATION",
  ]));
  assert.equal(result.blockingCount, 2);
});

test("payout requests require consistent approval/application evidence and current payee verification", () => {
  const result = evaluatePayrollConnectedRelease({
    ...input(),
    payoutChanges: [
      { id: 1, employeeId: 1, status: "pending", appliedAt: null },
      { id: 2, employeeId: 2, status: "approved", appliedAt: null },
      { id: 3, employeeId: 2, status: "approved", appliedAt: "2026-10-16T08:01:00Z" },
      { id: 4, employeeId: 1, status: "approved", appliedAt: "2026-10-16T07:00:00Z" },
      { id: 5, employeeId: 1, status: "rejected", appliedAt: null },
    ],
  });
  assert.equal(result.blockingCount, 3);
  assert.equal(result.ready, false);
  assert.equal(result.findings.every((f) => !JSON.stringify(f).includes("bankAccount")), true);
});

test("WFM corrections, blocker events, and latest timesheet state block payroll without overreacting to warnings", () => {
  const result = evaluatePayrollConnectedRelease({
    ...input(),
    attendanceCorrections: [
      { id: 1, employeeId: 1, status: "pending", workDate: "2026-10-05", appliedAt: null },
      { id: 2, employeeId: 2, status: "approved", workDate: "2026-10-05", appliedAt: "2026-10-16T09:00:00Z" },
      { id: 3, employeeId: 2, status: "approved", workDate: "2026-10-05", appliedAt: "2026-10-16T07:00:00Z" },
    ],
    attendanceExceptions: [
      { id: 4, employeeId: 1, status: "open", severity: "blocker", workDate: "2026-10-06" },
      { id: 5, employeeId: 2, status: "open", severity: "warning", workDate: "2026-10-06" },
      { id: 6, employeeId: 2, status: "resolved", severity: "blocker", workDate: "2026-10-06" },
    ],
    timesheets: [
      { id: 10, employeeId: 1, periodStart: "2026-10-01", periodEnd: "2026-10-15", version: 1, status: "approved" },
      { id: 11, employeeId: 1, periodStart: "2026-10-01", periodEnd: "2026-10-15", version: 2, status: "stale" },
      { id: 12, employeeId: 2, periodStart: "2026-10-01", periodEnd: "2026-10-15", version: 1, status: "approved" },
    ],
  });
  assert.equal(result.blockingCount, 4);
  assert.equal(result.reviewCount, 1);
  assert.ok(result.findings.some((f) => f.code === "WFM_LATEST_TIMESHEET_NOT_APPROVED" && f.sourceId === 11));
});

test("employer block-mode timesheet policy requires coverage of every payroll employee", () => {
  const required = evaluatePayrollConnectedRelease({
    ...input(),
    timesheetApprovalRequired: true,
    timesheets: [{
      id: 9, employeeId: 1, periodStart: "2026-10-01", periodEnd: "2026-10-15",
      version: 1, status: "approved",
    }],
  });
  assert.equal(required.ready, false);
  assert.equal(required.blockingCount, 1);
  assert.ok(required.findings.some((f) => f.code === "WFM_TIMESHEET_MISSING" && f.employeeId === 2));

  // An employer with advisory-mode timesheets continues to use its own
  // configured WFM gate and is not falsely blocked for missing submissions.
  const advisory = evaluatePayrollConnectedRelease({
    ...input(), timesheetApprovalRequired: false,
  });
  assert.equal(advisory.ready, true);
});

test("HCM proposed salary changes are review-only; scheduled or late-applied pay changes must block", () => {
  const result = evaluatePayrollConnectedRelease({
    ...input(),
    compensationProposals: [
      { id: 1, employeeId: 1, status: "proposed", effectiveDate: "2026-10-05", appliedAt: null },
      { id: 2, employeeId: 2, status: "scheduled", effectiveDate: "2026-10-10", appliedAt: null },
      { id: 3, employeeId: 2, status: "applied", effectiveDate: "2026-10-08", appliedAt: "2026-10-16T09:00:00Z" },
      { id: 4, employeeId: 2, status: "applied", effectiveDate: "2026-10-07", appliedAt: "2026-10-16T07:00:00Z" },
    ],
    payRevisions: [
      { id: 5, employeeId: 1, effectiveDate: "2026-09-01", createdAt: "2026-10-16T10:00:00Z" },
      { id: 6, employeeId: 1, effectiveDate: "2026-10-02", createdAt: "2026-10-16T07:00:00Z" },
    ],
    restDayRevisions: [
      { id: 7, employeeId: 2, effectiveDate: "2026-10-04", createdAt: "2026-10-16T09:00:00Z" },
    ],
  });
  assert.equal(result.ready, false);
  assert.equal(result.blockingCount, 4);
  assert.equal(result.reviewCount, 1);
  assert.ok(result.findings.some((f) => f.code === "HCM_PAY_REVISION_AFTER_CALCULATION"));
  assert.ok(result.findings.some((f) => f.code === "WFM_REST_DAY_AFTER_CALCULATION"));
});

test("over-limit data and invalid calendar dates are never interpreted as a clean payroll", () => {
  const incomplete = evaluatePayrollConnectedRelease({
    ...input(), truncatedSources: ["timesheets", "attendanceCorrections"],
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.blockingCount, 2);
  const invalid = evaluatePayrollConnectedRelease({ ...input(), periodStart: "2026-02-30" });
  assert.equal(invalid.ready, false);
  assert.ok(invalid.findings.some((f) => f.code === "INVALID_PAYROLL_PERIOD"));
});

test("flag is default OFF and final release, checker and review submission contain independent server checks", () => {
  const checklist = readFileSync("src/lib/payroll-release-checklist.ts", "utf8");
  const submit = readFileSync("src/app/api/payroll-runs/[id]/submit-review/route.ts", "utf8");
  const approve = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const server = readFileSync("src/lib/payroll-connected-release-gate-server.ts", "utf8");
  assert.ok(server.includes('process.env.PAYROLL_CONNECTED_RELEASE_GATE_ENABLED !== "true"'));
  assert.ok(server.includes("PAYROLL_CONNECTED_RELEASE_GATE_ORGANIZATION_IDS"));
  assert.ok(server.includes("connectedPayrollReleaseGateEnabled(run.organizationId)"));
  assert.ok(server.includes('process.env.PAYROLL_CONNECTED_IMPACT_ENABLED !== "true"'));
  assert.ok(server.includes("companyId"));
  assert.ok(server.includes("inArray(workerEffectiveChanges.employeeId, employeeIds)"));
  assert.ok(server.includes("eq(workforceTimesheets.periodEnd, end)"));
  assert.ok(server.includes('timesheetPolicy.enforcementMode === "block"'));
  assert.ok(server.includes("gte(employeePayRevisions.createdAt") === false
    && server.includes("gt(employeePayRevisions.createdAt, since)"));
  assert.ok(checklist.includes('key: "connected"'));
  assert.ok(submit.includes('item.key === "connected"'));
  assert.ok(checklist.includes("connectedPayrollReleaseGateEnabled(run.organizationId)"));
  assert.ok(approve.includes("connectedPayrollReleaseGateEnabled(payrollRun.organizationId)"));
  assert.ok(release.includes("connectedPayrollReleaseGateEnabled(run.organizationId)"));
  assert.ok(approve.includes("safePayrollConnectedReleaseReadiness(payrollRunId)"));
  assert.ok(release.includes("safePayrollConnectedReleaseReadiness(runId)"));
  assert.ok(release.includes('eq(payrollRuns.status, "Releasing")'));
});
