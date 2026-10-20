import assert from "node:assert/strict";
import test from "node:test";
import { buildHrPayrollReadiness, hrPayrollReadinessPresentation } from "../src/lib/hr-payroll-readiness";
import { readFileSync } from "node:fs";

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

test("a new employer with zero workers is not falsely shown as fully payroll ready", () => {
  const model = buildHrPayrollReadiness({ employees: [], provisioning: [] });
  assert.equal(model.total, 0);
  assert.deepEqual(hrPayrollReadinessPresentation(model), {
    hasEligibleEmployees: false,
    percentage: null,
    heading: "No eligible employees to assess",
    statusLabel: "Not assessed",
  });
});

test("inactive and future-period hires are not equivalent to a ready payroll roster", () => {
  const model = buildHrPayrollReadiness({
    employees: [
      { ...baseEmployee, id: 1, status: "Inactive" },
      { ...baseEmployee, id: 2, startDate: "2026-11-01" },
    ],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
    provisioning: [],
  });
  assert.equal(model.total, 0);
  assert.equal(hrPayrollReadinessPresentation(model).percentage, null);
  assert.equal(hrPayrollReadinessPresentation(model).statusLabel, "Not assessed");
});

test("assessed workers preserve authentic readiness percentages and issue labels", () => {
  const model = buildHrPayrollReadiness({
    employees: [baseEmployee, { ...baseEmployee, id: 2, bankAccount: null }],
    punches: [
      { employeeId: 1, workDate: "2026-10-02", status: "Complete" },
      { employeeId: 2, workDate: "2026-10-02", status: "Complete" },
    ],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15", periodLabel: "Oct 1–15" },
    provisioning: [],
  });
  assert.equal(model.total, 2);
  assert.equal(model.ready, 1);
  assert.deepEqual(hrPayrollReadinessPresentation(model), {
    hasEligibleEmployees: true,
    percentage: 50,
    heading: "1 of 2 employees ready",
    statusLabel: "1 needs attention",
  });
  const complete = buildHrPayrollReadiness({
    employees: [baseEmployee],
    punches: [{ employeeId: 1, workDate: "2026-10-02", status: "Complete" }],
    period: { periodStart: "2026-10-01", periodEnd: "2026-10-15" },
    provisioning: [],
  });
  assert.equal(hrPayrollReadinessPresentation(complete).percentage, 100);
  assert.equal(hrPayrollReadinessPresentation(complete).statusLabel, "All assessed employees ready");
});

test("HR readiness UI renders the unassessed state instead of manufacturing a 100 percent success", () => {
  const source = readFileSync("src/components/workspace/hr-payroll-readiness.tsx", "utf8");
  assert.match(source, /hrPayrollReadinessPresentation\(model\)/);
  assert.match(source, /percentage === null \? "—"/);
  assert.match(source, /readiness\.hasEligibleEmployees/);
  assert.match(source, /Readiness not assessed/);
  assert.doesNotMatch(source, /model\.total \? Math\.round\(\(model\.ready \/ model\.total\) \* 100\) : 100/);
});
