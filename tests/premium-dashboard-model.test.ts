import assert from "node:assert/strict";
import test from "node:test";
import { buildPremiumDashboardModel } from "../src/lib/premium-dashboard-model";
import type { DashboardData, PayrollRun } from "../src/components/workspace/types";

const today = new Date("2026-10-11T01:00:00Z");

function sampleData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    employees: [
      { id: 1, status: "Active", bankAccount: "masked", bankCode: "B1", tin: "T1", sssNo: "S1", philHealthNo: "P1", pagIbigNo: "I1" },
      { id: 2, status: "Active", bankAccount: null, bankCode: null, tin: null, sssNo: "S2", philHealthNo: "P2", pagIbigNo: "I2" },
      { id: 3, status: "On leave", bankAccount: null, bankCode: null },
    ] as DashboardData["employees"],
    payrollEntries: [
      { id: 1, employeeId: 1, status: "Ready", grossPay: "1000", deductions: "150", netPay: "850", trace: { inputs: ["employerStatutoryCost=100"] } },
      { id: 2, employeeId: 2, status: "Exception", grossPay: "1000", deductions: "150", netPay: "850", trace: { inputs: ["employerStatutoryCost=90"] } },
    ],
    punches: [
      { id: 1, employeeId: 2, workDate: "2026-10-08", status: "incomplete", timeIn: null, timeOut: null },
      { id: 2, employeeId: 2, workDate: "2026-10-09", status: "incomplete", timeIn: null, timeOut: null },
      { id: 3, employeeId: 1, workDate: "2026-09-10", status: "incomplete", timeIn: null, timeOut: null },
    ],
    leaveRequests: [{ id: 1, status: "Pending" }] as DashboardData["leaveRequests"],
    tasks: [
      { id: 1, status: "Pending" },
      { id: 2, status: "Pending" },
      { id: 3, status: "Approved" },
    ] as DashboardData["tasks"],
    complianceActions: [{ id: 1, title: "Verified calendar action", dueDate: "2026-10-22", status: "open", detail: "" }] as DashboardData["complianceActions"],
    ...overrides,
  } as DashboardData;
}

function sampleRun(overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: 10,
    periodLabel: "October 1–15",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    scopeLabel: "Regular",
    status: "Needs review",
    payDate: "2026-10-20",
    employeeCount: 2,
    grossPay: "2000",
    netPay: "1700",
    exceptions: 1,
    ruleVersion: "test",
    ...overrides,
  };
}

test("premium dashboard reconciles run totals with complete employer cost traces", () => {
  const data = sampleData();
  const model = buildPremiumDashboardModel(data, sampleRun(), today);
  assert.equal(model.activeCount, 2);
  assert.equal(model.totalCount, 3);
  assert.equal(model.payrollEmployeeCount, 2);
  assert.equal(model.pendingApprovals, 2);
  assert.equal(model.pendingLeave, 1);
  assert.equal(model.attendanceEmployees, 1);
  assert.equal(model.missingRecords, 1);
  assert.equal(model.exceptions, 1);
  assert.equal(model.gross, 2000);
  assert.equal(model.net, 1700);
  assert.equal(model.deductions, 300);
  assert.equal(model.employerCosts, 190);
  assert.equal(model.totalCost, 2190);
  assert.equal(model.preliminary, true);
  assert.equal(model.issues.length, 3);
  assert.deepEqual(model.scheduledDates.map((item) => item.date), [
    "2026-10-15", "2026-10-20", "2026-10-22",
  ]);
});

test("premium dashboard does not invent a cost from incomplete employer traces", () => {
  const data = sampleData({
    payrollEntries: [
      { id: 1, employeeId: 1, status: "Ready", grossPay: "1000", deductions: "150", netPay: "850", trace: {} },
    ],
    complianceActions: [],
  });
  const model = buildPremiumDashboardModel(data, sampleRun(), today);
  assert.equal(model.employerCosts, null);
  assert.equal(model.totalCost, null);
  assert.deepEqual(model.scheduledDates.map((item) => item.key), ["cutoff", "payday"]);
});

test("draft payroll does not show calculated figures", () => {
  const model = buildPremiumDashboardModel(sampleData(), sampleRun({ status: "Draft" }), today);
  assert.equal(model.calculated, false);
  assert.equal(model.gross, null);
  assert.equal(model.net, null);
  assert.equal(model.totalCost, null);
  assert.equal(model.preliminary, false);
});

test("a closed period is not preliminary", () => {
  const model = buildPremiumDashboardModel(
    sampleData(),
    sampleRun({ periodEnd: "2026-10-09" }),
    today,
  );
  assert.equal(model.preliminary, false);
});
