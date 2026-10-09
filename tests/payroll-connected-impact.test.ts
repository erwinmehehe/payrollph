import assert from "node:assert/strict";
import test from "node:test";
import { buildPayrollConnectedImpact } from "../src/lib/payroll-connected-impact";

const cutoff = { periodStart: "2026-10-01", periodEnd: "2026-10-15" };

test("HRIS, WFM and HCM cutoff evidence is reconciled without money-bearing data", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    employmentChanges: [
      { id: 1, employeeId: 4, status: "scheduled", effectiveDate: "2026-10-04" },
      { id: 2, employeeId: 5, status: "applied", effectiveDate: "2026-10-03" },
      { id: 3, employeeId: 6, status: "pending_approval", effectiveDate: "2026-10-20" },
    ],
    payoutChanges: [
      { id: 4, employeeId: 4, status: "pending", appliedAt: null },
      { id: 5, employeeId: 5, status: "approved", appliedAt: "2026-10-01" },
    ],
    attendanceCorrections: [
      { id: 6, employeeId: 4, status: "pending", workDate: "2026-10-10" },
      { id: 7, employeeId: 4, status: "applied", workDate: "2026-10-10", appliedAt: "2026-10-11" },
      { id: 8, employeeId: 4, status: "pending", workDate: "2026-09-30" },
    ],
    attendanceExceptions: [
      { id: 9, employeeId: 4, status: "open", severity: "blocker", workDate: "2026-10-11" },
      { id: 10, employeeId: 4, status: "resolved", severity: "blocker", workDate: "2026-10-11" },
    ],
    compensationProposals: [
      { id: 11, employeeId: 4, status: "scheduled", effectiveDate: "2026-10-15" },
      { id: 12, employeeId: 4, status: "applied", effectiveDate: "2026-10-15" },
    ],
    payRevisions: [{ id: 13, employeeId: 4, effectiveDate: "2026-10-07" }],
  });
  assert.deepEqual(report.summary, { HRIS: 2, WFM: 2, HCM: 2 });
  assert.equal(report.total, 6);
  assert.equal(report.attention, 5);
  assert.equal(report.review, 1);
  assert.equal(report.advisoryOnly, true);
  assert.ok(report.findings.every((f) => !JSON.stringify(f).includes("bankAccount")));
  assert.ok(report.findings.every((f) => !JSON.stringify(f).includes("proposedAnnual")));
});

test("informational attendance evidence is review rather than blocked", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    attendanceExceptions: [{ id: 3, employeeId: 9, workDate: "2026-10-01", severity: "info", status: "open" }],
  });
  assert.equal(report.attention, 0);
  assert.equal(report.review, 1);
});

test("invalid dates and ranges fail closed", () => {
  assert.throws(() => buildPayrollConnectedImpact({ periodStart: "2026-02-30", periodEnd: "2026-03-01" }));
  assert.throws(() => buildPayrollConnectedImpact({ periodStart: "2026-10-20", periodEnd: "2026-10-01" }));
});

test("source cap warnings prevent falsely clean completion", () => {
  const report = buildPayrollConnectedImpact({ ...cutoff, truncatedSources: ["attendanceExceptions"] });
  assert.equal(report.total, 0);
  assert.equal(report.incomplete, true);
  assert.deepEqual(report.truncatedSources, ["attendanceExceptions"]);
});

test("no mutation or automatic financial authorization occurs", () => {
  const input = {
    ...cutoff,
    payoutChanges: [{ id: 1, employeeId: 2, status: "pending", appliedAt: null }],
    compensationProposals: [{ id: 3, employeeId: 2, status: "pending_approval", effectiveDate: "2026-10-12" }],
  };
  const snapshot = JSON.stringify(input);
  const report = buildPayrollConnectedImpact(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(report.findings.length, 2);
  assert.equal(report.advisoryOnly, true);
});

import { readFileSync } from "node:fs";

test("default-off connected payroll impact avoids a 404 console error and has no response body", () => {
  const endpoint = readFileSync("src/app/api/payroll-runs/[id]/connected-impact/route.ts", "utf8");
  const panel = readFileSync("src/components/workspace/payroll-connected-impact-panel.tsx", "utf8");
  assert.ok(endpoint.includes("process.env.PAYROLL_CONNECTED_IMPACT_ENABLED !== \"true\""));
  assert.ok(endpoint.includes("return new Response(null, {"));
  assert.ok(endpoint.includes("status: 204"));
  assert.ok(panel.includes("if (response.status === 204)"));
  assert.ok(panel.includes("setEnabled(false)"));
});


test("latest approved timesheet version takes precedence over superseded submitted evidence", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    timesheets: [
      { id: 1, employeeId: 12, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 1, status: "submitted" },
      { id: 2, employeeId: 12, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 2, status: "approved" },
      { id: 3, employeeId: 13, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 1, status: "approved" },
      { id: 4, employeeId: 13, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 2, status: "stale" },
      { id: 5, employeeId: 14, periodStart: "2026-09-16", periodEnd: "2026-09-30", version: 1, status: "submitted" },
    ],
  });
  assert.equal(report.summary.WFM, 1);
  assert.equal(report.attention, 1);
  assert.equal(report.total, 1);
  assert.equal(report.findings[0].sourceId, 4);
  assert.equal(report.findings[0].code, "WFM_TIMESHEET_NOT_APPROVED");
});

test("same-version timesheet tie uses higher source record and never silently clears a stale revision", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    timesheets: [
      { id: 41, employeeId: 15, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 3, status: "approved" },
      { id: 42, employeeId: 15, periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, version: 3, status: "stale" },
    ],
  });
  assert.equal(report.attention, 1);
  assert.equal(report.findings[0].sourceId, 42);
});

test("connected-impact API reads only cutoff-matching timesheets, with feature flag and existing payroll RBAC", () => {
  const source = readFileSync("src/app/api/payroll-runs/[id]/connected-impact/route.ts", "utf8");
  assert.ok(source.includes("PAYROLL_CONNECTED_IMPACT_ENABLED"));
  assert.ok(source.includes("PAYROLL_VIEW_ROLES"));
  assert.ok(source.includes("eq(workforceTimesheets.periodStart, run.periodStart)"));
  assert.ok(source.includes("eq(workforceTimesheets.periodEnd, run.periodEnd)"));
  assert.ok(source.includes("timesheets: timesheets.slice(0, ROW_CAP)"));
});


test("effective pay revisions show whether an approved compensation proposal is linked", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    payRevisions: [
      { id: 11, employeeId: 1, effectiveDate: "2026-10-04", compensationProposalId: 200 },
      { id: 12, employeeId: 2, effectiveDate: "2026-10-05" },
      { id: 13, employeeId: 3, effectiveDate: "2026-09-30", compensationProposalId: 201 },
    ],
  });
  assert.equal(report.summary.HCM, 2);
  assert.equal(report.review, 2);
  assert.deepEqual(report.findings.map((f) => f.code).sort(),
    ["HCM_LINKED_PAY_REVISION", "HCM_PAY_REVISION_SOURCE_REVIEW"]);
  assert.ok(report.findings.every((f) => !JSON.stringify(f).includes("proposedAnnual")));
});

test("HRIS payout and WFM correction decisions with inconsistent applied evidence stay visible", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    payoutChanges: [
      { id: 10, employeeId: 1, status: "approved", appliedAt: null },
      { id: 11, employeeId: 2, status: "pending", appliedAt: "2026-10-05" },
      { id: 12, employeeId: 3, status: "approved", appliedAt: "2026-10-05" },
      { id: 13, employeeId: 4, status: "rejected", appliedAt: null },
    ],
    attendanceCorrections: [
      { id: 21, employeeId: 1, status: "approved", workDate: "2026-10-03", appliedAt: null },
      { id: 22, employeeId: 2, status: "pending", workDate: "2026-10-03", appliedAt: "2026-10-04" },
      { id: 23, employeeId: 3, status: "approved", workDate: "2026-10-03", appliedAt: "2026-10-04" },
      { id: 24, employeeId: 4, status: "rejected", workDate: "2026-10-03", appliedAt: null },
    ],
  });
  assert.deepEqual(report.summary, { HRIS: 2, WFM: 2, HCM: 0 });
  assert.equal(report.attention, 4);
});

test("linked compensation source selection requires matching approved/apply evidence", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/connected-impact/route.ts", "utf8");
  assert.ok(route.includes("proposal.status !== \"applied\""));
  assert.ok(route.includes("!proposal.approvedAt || !proposal.appliedAt"));
  assert.ok(route.includes("proposal.employeeId === revision.employeeId"));
  assert.ok(route.includes("proposal.effectiveDate === revision.effectiveDate"));
});


test("late HRIS, payout, attendance and retroactive salary changes are flagged after run creation", () => {
  const report = buildPayrollConnectedImpact({
    ...cutoff,
    employmentChanges: [
      { id: 31, employeeId: 5, status: "applied", effectiveDate: "2026-09-15", appliedAfterRunCreated: true },
      { id: 32, employeeId: 6, status: "applied", effectiveDate: "2026-10-03", appliedAfterRunCreated: false },
    ],
    payoutChanges: [
      { id: 33, employeeId: 5, status: "approved", appliedAt: "2026-10-07", appliedAfterRunCreated: true },
      { id: 34, employeeId: 6, status: "approved", appliedAt: "2026-10-05", appliedAfterRunCreated: false },
    ],
    attendanceCorrections: [
      { id: 35, employeeId: 5, status: "approved", appliedAt: "2026-10-07", workDate: "2026-10-04", appliedAfterRunCreated: true },
      { id: 36, employeeId: 6, status: "approved", appliedAt: "2026-10-05", workDate: "2026-10-04", appliedAfterRunCreated: false },
    ],
    payRevisions: [
      { id: 37, employeeId: 5, effectiveDate: "2026-09-01", createdAfterRunCreated: true },
      { id: 38, employeeId: 6, effectiveDate: "2026-09-01", createdAfterRunCreated: false },
    ],
  });
  assert.deepEqual(report.summary, { HRIS: 2, WFM: 1, HCM: 1 });
  assert.equal(report.attention, 4);
  assert.deepEqual(new Set(report.findings.map((f) => f.code)), new Set([
    "HRIS_LATE_EMPLOYMENT_CHANGE",
    "HRIS_LATE_PAYOUT_CHANGE",
    "WFM_LATE_ATTENDANCE_CORRECTION",
    "HCM_LATE_EFFECTIVE_PAY_REVISION",
  ]));
});

test("late-source query coverage retains backdated revisions but excludes settled historical events", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/connected-impact/route.ts", "utf8");
  assert.ok(route.includes("gte(workerEffectiveChanges.appliedAt, run.createdAt)"));
  assert.ok(route.includes("gte(compensationProposals.appliedAt, run.createdAt)"));
  assert.ok(route.includes("lt(employeePayRevisions.effectiveDate, run.periodStart)"));
  assert.ok(route.includes("gte(employeePayRevisions.createdAt, run.createdAt)"));
  assert.ok(route.includes("createdAfterRunCreated: appliedAfterRunCreation(revision.createdAt)"));
});


test("payroll impact action buttons require the current workspace role's allowed pages", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  const panel = readFileSync("src/components/workspace/payroll-connected-impact-panel.tsx", "utf8");
  assert.ok(workspace.includes("availablePages={availablePages}"));
  assert.ok(payroll.includes("allowedPages={availablePages}"));
  assert.ok(panel.includes("allowedPages.includes(finding.action)"));
  assert.ok(panel.includes("Ask a permitted HR, workforce or finance reviewer"));
});
