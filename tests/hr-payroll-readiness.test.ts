import assert from "node:assert/strict";
import test from "node:test";
import { buildHrPayrollReadiness } from "../src/lib/hr-payroll-readiness";

const baseEmployee = {
  id: 1,
  firstName: "Ana",
  lastName: "Reyes",
  employeeNo: "E-001",
  status: "Active",
  startDate: "2026-01-01",
  bankAccount: "••••1234",
  bankCode: "BDO",
  tin: "masked",
  tinBranchCode: "masked",
  sssNo: "masked",
  philHealthNo: "masked",
  pagIbigNo: "masked",
  payBasis: "monthly",
  payRate: "30000",
  standardWorkDaysPerMonth: "22",
  standardHoursPerDay: "8",
  restDay: "Sunday",
};

test("employee flips to ready only when payroll input blockers are clear", () => {
  const model = buildHrPayrollReadiness({
    employees: [baseEmployee],
    punches: [{ employeeId: 1, workDate: "2026-10-01", status: "Complete" }],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
  });
  assert.equal(model.ready, 1);
  assert.equal(model.blocked, 0);
  assert.equal(model.rows[0].ready, true);
});

test("readiness groups employee, statutory, schedule and attendance blockers in one queue", () => {
  const model = buildHrPayrollReadiness({
    employees: [{
      ...baseEmployee,
      bankAccount: null,
      tin: null,
      payRate: "0",
      restDay: null,
    }],
    punches: [{ employeeId: 1, workDate: "2026-10-02", status: "Incomplete" }],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
  });
  const keys = model.rows[0].issues.map((issue) => issue.key);
  assert.ok(keys.includes("bank_details"));
  assert.ok(keys.includes("government_ids"));
  assert.ok(keys.includes("pay_basis"));
  assert.ok(keys.includes("rest_day"));
  assert.ok(keys.includes("attendance"));
  assert.equal(model.rows[0].ready, false);
});

test("attendance is scoped to the current payroll period and leave overlaps are detected", () => {
  const model = buildHrPayrollReadiness({
    employees: [baseEmployee],
    punches: [
      { employeeId: 1, workDate: "2026-09-15", status: "Exception" },
      { employeeId: 1, workDate: "2026-10-02", status: "Complete" },
    ],
    leaveRequests: [
      { id: 1, employeeId: 1, startDate: "2026-10-05", endDate: "2026-10-07", status: "Approved" },
      { id: 2, employeeId: 1, startDate: "2026-10-07", endDate: "2026-10-08", status: "Pending" },
    ],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
  });
  const keys = model.rows[0].issues.map((issue) => issue.key);
  assert.ok(!keys.includes("attendance"));
  assert.ok(keys.includes("leave_overlap"));
});

test("future hires outside the payroll period are not treated as current blockers", () => {
  const model = buildHrPayrollReadiness({
    employees: [{ ...baseEmployee, startDate: "2026-11-01", bankAccount: null }],
    punches: [],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
  });
  assert.equal(model.total, 0);
});

test("separating employees need an employment-date record", () => {
  const model = buildHrPayrollReadiness({
    employees: [{ ...baseEmployee, status: "Separating" }],
    punches: [{ employeeId: 1, workDate: "2026-10-02", status: "Complete" }],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
  });
  assert.ok(model.rows[0].issues.some((issue) => issue.key === "employment_dates"));
});
