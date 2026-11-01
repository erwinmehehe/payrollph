import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWfmOpsSignals,
  filterWfmOpsSignals,
  isValidWfmOpsPeriod,
  projectAttendanceOps,
  projectTimesheetOps,
  recentAttendanceWindow,
  suggestCompletedHalfMonth,
} from "../src/lib/workforce-operations-inbox";

test("attendance projection strips employee identifiers and preserves authoritative counts", () => {
  const value = projectAttendanceOps({
    summary: { open: 5, overdue: 2, unassigned: 1, resolved: 9 },
    exceptions: [{ employeeName: "SENSITIVE", bankAccount: "SENSITIVE" }],
  });
  assert.deepEqual(value, { open: 5, overdue: 2, unassigned: 1, resolved: 9 });
  assert.ok(!JSON.stringify(value).includes("SENSITIVE"));
  assert.throws(() => projectAttendanceOps({ summary: { open: 1, overdue: 2, unassigned: 0, resolved: 0 } }));
});

test("timesheet projection counts unique expected employees without inventing missing source", () => {
  const value = projectTimesheetOps({
    manager: true,
    policy: { active: true, enforcementMode: "block" },
    latest: [
      { employeeId: 1, status: "submitted", blockerCount: 1, salary: "SENSITIVE" },
      { employeeId: 2, status: "approved", blockerCount: 0 },
      { employeeId: 3, status: "stale", blockerCount: 0 },
    ],
    expectations: [
      { employeeId: 1, status: "expected" },
      { employeeId: 4, status: "expected" },
      { employeeId: 4, status: "expected" },
      { employeeId: 5, status: "cancelled" },
    ],
  });
  assert.equal(value.pendingReview, 1);
  assert.equal(value.approved, 1);
  assert.equal(value.blockers, 1);
  assert.equal(value.stale, 1);
  assert.equal(value.missingExpected, 1);
  assert.equal(value.enforcement, "block");
  assert.ok(!JSON.stringify(value).includes("SENSITIVE"));
  const signals = buildWfmOpsSignals(null, value);
  assert.equal(signals[0]?.priority, "urgent");
});

test("unknown or duplicate timesheet evidence must fail closed", () => {
  assert.throws(() => projectTimesheetOps({ manager: false, latest: [], expectations: [], policy: { active: true, enforcementMode: "block" } }));
  assert.throws(() => projectTimesheetOps({
    manager: true, latest: [{ employeeId: 1, status: "approved", blockerCount: 0 }, { employeeId: 1, status: "submitted", blockerCount: 0 }],
    expectations: [], policy: { active: true, enforcementMode: "block" },
  }));
  assert.throws(() => projectTimesheetOps({ manager: true, latest: [], expectations: [], policy: { active: true, enforcementMode: "unknown" } }));
});

test("Philippine windows cover month and leap year boundaries", () => {
  assert.deepEqual(recentAttendanceWindow("2026-10-10"), { startDate: "2026-09-27", endDate: "2026-10-10" });
  assert.deepEqual(suggestCompletedHalfMonth("2026-10-10"), { periodStart: "2026-09-16", periodEnd: "2026-09-30" });
  assert.deepEqual(suggestCompletedHalfMonth("2026-10-16"), { periodStart: "2026-10-01", periodEnd: "2026-10-15" });
  assert.deepEqual(suggestCompletedHalfMonth("2024-03-01"), { periodStart: "2024-02-16", periodEnd: "2024-02-29" });
  assert.throws(() => recentAttendanceWindow("2026-02-30"));
});

test("unknown/unavailable sources are not treated as zero", () => {
  assert.deepEqual(buildWfmOpsSignals(null, null), []);
  const signals = buildWfmOpsSignals({ open: 1, overdue: 1, unassigned: 0, resolved: 0 }, null);
  assert.deepEqual(signals.map(s => s.id), ["attendance-overdue", "attendance-open"]);
});

test("manager priority filter is a pure local view, never a new approval", () => {
  const source = { open: 5, overdue: 2, unassigned: 1, resolved: 0 };
  const signals = buildWfmOpsSignals(source, null);
  assert.deepEqual(filterWfmOpsSignals(signals, "all"), signals);
  assert.deepEqual(filterWfmOpsSignals(signals, "urgent").map(s => s.id), ["attendance-overdue"]);
  assert.deepEqual(filterWfmOpsSignals(signals, "review").map(s => s.id), ["attendance-open", "attendance-unassigned"]);
  assert.equal(filterWfmOpsSignals([], "urgent").length, 0);
  assert.equal(signals.length, 3, "Filtering must not mutate source evidence or priorities");
});

test("manager period selection rejects impossible and reversed calendar dates", () => {
  assert.equal(isValidWfmOpsPeriod("2024-02-29", "2024-03-15"), true);
  assert.equal(isValidWfmOpsPeriod("2026-02-29", "2026-03-15"), false);
  assert.equal(isValidWfmOpsPeriod("2026-04-31", "2026-05-15"), false);
  assert.equal(isValidWfmOpsPeriod("2026-11-16", "2026-11-15"), false);
  assert.equal(isValidWfmOpsPeriod("2026-11-01", "2026-11-01"), true);
});
