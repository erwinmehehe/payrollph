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
