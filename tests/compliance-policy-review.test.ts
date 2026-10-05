import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCompliancePolicyReview, patternProvidesWeeklyRest, type PolicyReviewInput } from "../src/lib/compliance-policy-review";

function baseInput(): PolicyReviewInput {
  return {
    payrollCalendarMode: "ph_semi_monthly",
    releasedRuns: [{ id: 1, periodLabel: "Sep 1-15", periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" }],
    employees: [{ id: 1, employeeNo: "EMP-1", name: "Ana Reyes", status: "Active", startDate: "2024-01-01", restDay: "Sunday" }],
    payProfiles: [{ employeeId: 1, payBasis: "monthly", standardHoursPerDay: 8 }],
    leavePolicies: [{ leaveType: "Annual leave", annualDays: 15, payTreatment: "paid", paidPercentage: 100, active: true }],
    scheduleAssignments: [], patterns: [], patternDays: [], today: "2026-10-05",
  };
}

test("rolling schedule review rejects a cycle with any seven-day window lacking rest", () => {
  assert.equal(patternProvidesWeeklyRest(7, [{ dayIndex: 6, isRestDay: true }]), true);
  assert.equal(patternProvidesWeeklyRest(14, [{ dayIndex: 6, isRestDay: true }, { dayIndex: 13, isRestDay: true }]), true);
  assert.equal(patternProvidesWeeklyRest(14, [{ dayIndex: 13, isRestDay: true }]), false);
});

test("released payroll period longer than 16 days is a high policy finding", () => {
  const input = baseInput();
  input.releasedRuns = [{ id: 2, periodLabel: "Bad interval", periodStart: "2026-09-01", periodEnd: "2026-09-20", payDate: "2026-09-20" }];
  const result = buildCompliancePolicyReview(input);
  const finding = result.findings.find((row) => row.key === "PAY_FREQUENCY_INTERVAL");
  assert.equal(finding?.severity, "high");
});

test("rest-day policy accepts a rotating schedule only when every rolling seven-day window contains rest", () => {
  const input = baseInput();
  input.employees[0].restDay = null;
  input.scheduleAssignments = [{ employeeId: 1, patternId: 7, effectiveFrom: "2026-01-01", effectiveUntil: null }];
  input.patterns = [{ id: 7, code: "ROT14", name: "14-day rotation", cycleDays: 14, active: true }];
  input.patternDays = [{ patternId: 7, dayIndex: 6, isRestDay: true }, { patternId: 7, dayIndex: 13, isRestDay: true }];
  let result = buildCompliancePolicyReview(input);
  assert.equal(result.findings.find((row) => row.key === "WEEKLY_REST_CONTROL")?.severity, "pass");
  input.patternDays = [{ patternId: 7, dayIndex: 13, isRestDay: true }];
  result = buildCompliancePolicyReview(input);
  assert.equal(result.findings.find((row) => row.key === "WEEKLY_REST_CONTROL")?.severity, "medium");
});

test("SIL review stays a review finding rather than declaring a violation", () => {
  const input = baseInput();
  input.leavePolicies = [{ leaveType: "Unpaid leave", annualDays: 10, payTreatment: "unpaid", paidPercentage: 0, active: true }];
  const finding = buildCompliancePolicyReview(input).findings.find((row) => row.key === "SIL_POLICY_COVERAGE");
  assert.equal(finding?.severity, "medium");
  assert.match(finding?.detail ?? "", /exemptions and equivalent-benefit/);
});

test("unconfigured leave payroll treatment is a high configuration defect", () => {
  const input = baseInput();
  input.leavePolicies = [{ leaveType: "Special leave", annualDays: 3, payTreatment: "unconfigured", paidPercentage: 100, active: true }];
  assert.equal(buildCompliancePolicyReview(input).findings.find((row) => row.key === "LEAVE_PAYROLL_TREATMENT")?.severity, "high");
});

test("working day above eight hours is review-only because lawful alternatives can exist", () => {
  const input = baseInput();
  input.payProfiles[0].standardHoursPerDay = 10;
  const finding = buildCompliancePolicyReview(input).findings.find((row) => row.key === "STANDARD_HOURS_REVIEW");
  assert.equal(finding?.severity, "medium");
  assert.match(finding?.detail ?? "", /compressed workweek/);
});

test("policy review API is company-wide and Compliance Center renders the panel", () => {
  const route = readFileSync("src/app/api/compliance/policy-review/route.ts", "utf8");
  const panels = readFileSync("src/components/workspace/panels.tsx", "utf8");
  const ui = readFileSync("src/components/workspace/compliance-policy-review-panel.tsx", "utf8");
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("checker"));
  assert.ok(route.includes("Cache-Control"));
  assert.ok(panels.includes("CompliancePolicyReviewPanel"));
  assert.ok(ui.includes("not a legal opinion or DOLE certification"));
  assert.ok(ui.includes("Needs attention"));
});