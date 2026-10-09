import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_LEAVE_CALENDAR_DAYS,
  MAX_PRECISE_LEAVE_INTERVALS,
  checkEmployeeLeaveEligibility,
  leaveDateWindow,
  validLeaveDate,
} from "../src/lib/hcm-leave-employment";

const worker = {
  employeeStatus: "Active",
  employmentStartDate: "2024-05-01",
  leaveStartDate: "2026-10-09",
  leaveEndDate: "2026-10-10",
};

test("Gregorian date validation rejects fake February days and malformed dates", () => {
  assert.equal(validLeaveDate("2024-02-29"), true);
  assert.equal(validLeaveDate("2026-02-30"), false);
  assert.equal(validLeaveDate("2026-13-01"), false);
  assert.equal(validLeaveDate("2026-00-10"), false);
  assert.equal(validLeaveDate("2026-10-01T00:00:00Z"), false);
  assert.equal(validLeaveDate("10/09/2026"), false);
  assert.equal(validLeaveDate(""), false);
});

test("bounded leave window handles inclusive leap-year and cross-year dates", () => {
  assert.deepEqual(leaveDateWindow("2024-02-28", "2024-03-01"), { ok: true, calendarDays: 3 });
  assert.deepEqual(leaveDateWindow("2026-12-31", "2027-01-01"), { ok: true, calendarDays: 2 });
  assert.equal(leaveDateWindow("2026-10-11", "2026-10-09").ok, false);
  assert.equal(leaveDateWindow("2026-02-30", "2026-03-01").ok, false);
  assert.equal(leaveDateWindow("2026-01-01", "2027-12-31").ok, false);
  assert.equal(MAX_LEAVE_CALENDAR_DAYS, 366);
  assert.equal(MAX_PRECISE_LEAVE_INTERVALS, 1500);
});

test("new leave cannot predate actual employment", () => {
  const result = checkEmployeeLeaveEligibility({
    ...worker,
    leaveStartDate: "2024-04-30",
    leaveEndDate: "2024-05-01",
  });
  assert.equal(result?.code, "LEAVE_BEFORE_EMPLOYMENT");
});

test("separated and terminated employees cannot submit ordinary active leave", () => {
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Separated",
  })?.code, "LEAVE_SEPARATED_EMPLOYEE");
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Terminated",
  })?.code, "LEAVE_SEPARATED_EMPLOYEE");
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Suspended",
  })?.code, "LEAVE_EMPLOYMENT_STATUS_UNVERIFIED");
});

test("separating workers can take leave through verified last day only", () => {
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Separating", separationLastDay: "2026-10-10",
  }), null);
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Separating", separationLastDay: "2026-10-09",
  })?.code, "LEAVE_AFTER_SEPARATION");
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Separating", separationLastDay: null,
  })?.code, "LEAVE_SEPARATION_END_UNVERIFIED");
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "Separating", separationLastDay: "2026-02-30",
  })?.code, "LEAVE_SEPARATION_END_UNVERIFIED");
});

test("normal active and on-leave employees preserve valid requests", () => {
  assert.equal(checkEmployeeLeaveEligibility(worker), null);
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employeeStatus: "On leave",
  }), null);
  assert.equal(checkEmployeeLeaveEligibility({
    ...worker, employmentStartDate: "bad",
  })?.code, "LEAVE_EMPLOYMENT_START_UNVERIFIED");
});

test("new leave submission and preview guard both require employment bounds", () => {
  const create = readFileSync("src/app/api/leave/route.ts", "utf8");
  const preview = readFileSync("src/app/api/leave/preview/route.ts", "utf8");
  for (const source of [create, preview]) {
    assert.ok(source.includes("checkEmployeeLeaveEligibility({"));
    assert.ok(source.includes("leaveDateWindow("));
    assert.ok(source.includes("separationRecords.lastDay"));
    assert.ok(source.includes("MAX_PRECISE_LEAVE_INTERVALS"));
  }
  assert.ok(create.includes("if (eligibility)"));
  assert.ok(preview.includes("LEAVE_PREVIEW_INVALID_INTERVALS"));
});

test("pending leave interval revisions are serial and audit/time invalidation is atomic", () => {
  const src = readFileSync("src/app/api/leave/route.ts", "utf8");
  const txStart = src.indexOf("const revised = await db.transaction(async (tx) => {");
  const txEnd = src.indexOf("return { intervalSet, staleTimesheetIds };", txStart);
  assert.ok(txStart > 0 && txEnd > txStart);
  const transaction = src.slice(txStart, txEnd);
  assert.ok(transaction.includes("for update"));
  assert.ok(transaction.includes("for share"));
  assert.ok(transaction.includes("LEAVE_REVISION_STALE"));
  assert.ok(transaction.includes("checkEmployeeLeaveEligibility({"));
  assert.ok(transaction.includes('status: "superseded"'));
  assert.ok(transaction.includes("tx.insert(leaveRequestIntervalSets)"));
  assert.ok(transaction.includes("tx.insert(leaveRequestIntervals)"));
  assert.ok(transaction.includes("tx.update(workforceTimesheets)"));
  assert.ok(transaction.includes("tx.insert(auditEvents)"));
  assert.ok(!src.includes("markTimesheetsStaleForEmployeeRange("));
});

test("leave approval decides task, leave status and payroll timesheet stale state in one transaction", () => {
  const src = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  const txStart = src.indexOf("const decisionResult = await db.transaction(async (tx) => {");
  const txEnd = src.indexOf("updated = decisionResult.updatedTask;", txStart);
  assert.ok(txStart > 0 && txEnd > txStart);
  const transaction = src.slice(txStart, txEnd);
  assert.ok(transaction.includes("tx.update(approvalTasks)"));
  assert.ok(transaction.includes("tx.update(leaveRequests)"));
  assert.ok(transaction.includes("tx.update(workforceTimesheets)"));
  assert.ok(transaction.includes("tx.insert(auditEvents)"));
  assert.ok(transaction.includes("LEAVE_APPROVAL_STALE"));
  assert.ok(transaction.includes("leaveRequestIntervalSets.revision, 1"));
  assert.ok(transaction.includes("originalIntervalSet?.createdByUserId === sessionUser.id"));
  assert.ok(transaction.includes("LEAVE_SELF_APPROVAL"));
  assert.ok(transaction.includes("LEAVE_REQUESTER_IDENTITY_UNKNOWN"));
  assert.ok(transaction.includes("LEAVE_EMPLOYMENT_NOT_ELIGIBLE"));
  assert.ok(transaction.includes("for update"));
  assert.ok(transaction.includes("checkEmployeeLeaveEligibility({"));
  assert.ok(!src.includes("await db.update(leaveRequests).set"));
  assert.ok(!src.includes("markTimesheetsStaleForEmployeeRange("));
});

test("new leave request, approval task, interval evidence and actor audit commit together", () => {
  const src = readFileSync("src/app/api/leave/route.ts", "utf8");
  const start = src.indexOf("const created = await db.transaction(async (tx) => {");
  const end = src.indexOf("return { task, row, intervalSet };", start);
  assert.ok(start > 0 && end > start);
  const tx = src.slice(start, end);
  assert.ok(tx.includes("for share"));
  assert.ok(tx.includes("LEAVE_EMPLOYMENT_NOT_ELIGIBLE"));
  assert.ok(tx.includes("checkEmployeeLeaveEligibility({"));
  assert.ok(tx.includes("tx.insert(approvalTasks)"));
  assert.ok(tx.includes("tx.insert(leaveRequests)"));
  assert.ok(tx.includes("tx.insert(leaveRequestIntervals)"));
  assert.ok(tx.includes("tx.insert(auditEvents)"));
});
