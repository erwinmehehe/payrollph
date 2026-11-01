import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getEmployeeQuickAccessStatus } from "../src/lib/employee-home-quick-access";

test("employee quick access uses only own self-service data and released-payslip count", () => {
  const data = {
    payslips: [{ entryId: 1 }, { entryId: 2 }],
    leave: { requests: [{ status: "Pending" }, { status: "Approved" }] },
    attendance: { today: { timeIn: "08:00", timeOut: null } },
  };
  const before = structuredClone(data);
  assert.deepEqual(getEmployeeQuickAccessStatus(data), {
    releasedPayslipCount: 2, pendingLeaveRequestCount: 1, todayAttendance: "clocked_in",
  });
  assert.deepEqual(data, before);
  assert.deepEqual(getEmployeeQuickAccessStatus({
    payslips: [], leave: { requests: [] }, attendance: { today: null },
  }), {
    releasedPayslipCount: 0, pendingLeaveRequestCount: 0, todayAttendance: "not_clocked_in",
  });
  assert.equal(getEmployeeQuickAccessStatus({
    payslips: [], leave: { requests: [] },
    attendance: { today: { timeIn: "08:00", timeOut: "17:00" } },
  }).todayAttendance, "complete");
});

test("home quick actions are touch-sized and navigate through existing safe callbacks", () => {
  const source = readFileSync("src/components/employee-home-dashboard.tsx", "utf8");
  assert.ok(source.includes("getEmployeeQuickAccessStatus(data)"));
  assert.ok(source.includes("onClick={onPay}"));
  assert.ok(source.includes("onClick={onRequestLeave}"));
  assert.ok(source.includes("onClick={onAttendance}"));
  assert.ok(source.includes("min-h-14"));
  assert.ok(!source.includes("fetch("));
  assert.ok(!source.includes("localStorage"));
});