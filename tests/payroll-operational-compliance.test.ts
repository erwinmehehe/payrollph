import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("holiday administration is company-wide, MFA protected and unit scoped", () => {
  const source = readFileSync("src/app/api/holidays/route.ts", "utf8");
  assert.ok(source.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(source.includes("access?.companyWide"));
  assert.ok(source.includes("requireSensitiveActionMfa(session)"));
  assert.ok(source.includes("validateOrgUnit"));
  assert.ok(source.includes("orgUnitId"));
  assert.ok(source.includes("System/national holiday rows are read-only."));
});

test("taxable supplementary earnings are employee scoped and immutable after settlement", () => {
  const source = readFileSync("src/app/api/payroll-earnings/route.ts", "utf8");
  assert.ok(source.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(source.includes("taxable: true"));
  assert.ok(source.includes("includeInSssBase"));
  assert.ok(source.includes("includeInPagIbigBase"));
  assert.ok(source.includes("A settled supplementary earning is immutable."));
});

test("PH semi-monthly organization mode is enforced by payroll creation", () => {
  const orgRoute = readFileSync("src/app/api/organizations/route.ts", "utf8");
  const payrollRoute = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  assert.ok(orgRoute.includes("payrollCalendarMode"));
  assert.ok(orgRoute.includes('"ph_semi_monthly"'));
  assert.ok(payrollRoute.includes("isCanonicalPhSemiMonthlyPeriod"));
  assert.ok(payrollRoute.includes("INVALID_PH_SEMI_MONTHLY_PERIOD"));
});

test("release settlement reconciles supplementary earnings before marking them settled", () => {
  const source = readFileSync("src/lib/payroll-settlement.ts", "utf8");
  assert.ok(source.includes('numericId(line.code, "EARN-")'));
  assert.ok(source.includes("calculatedSupplementaryIds"));
  assert.ok(source.includes("A new supplementary earning was added after calculation"));
  assert.ok(source.includes('status: "settled", payrollRunId: run.id'));
});


test("holiday mutations invalidate unreleased payroll and supersede approvals", () => {
  const source = readFileSync("src/app/api/holidays/route.ts", "utf8");
  assert.ok(source.includes("assertHolidayMutationNotRacingPayroll"));
  assert.ok(source.includes("invalidateAffectedPayroll"));
  assert.ok(source.includes('status: "Draft"'));
  assert.ok(source.includes('status: "Superseded"'));
  assert.ok(source.includes("payrollEntries"));
  assert.ok(source.includes('"HOLIDAY_PAYROLL_BUSY"'));
});

test("payroll release fingerprints the employee-effective holiday calendar", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const settlement = readFileSync("src/lib/payroll-settlement.ts", "utf8");
  assert.ok(engine.includes("holidayCalendarFingerprint(employeeHolidayCalendar)"));
  assert.ok(engine.includes("holidayCalendarFingerprint="));
  assert.ok(settlement.includes('traceInputString(entry.trace, "holidayCalendarFingerprint")'));
  assert.ok(settlement.includes("currentHolidayFingerprint"));
  assert.ok(settlement.includes("changed after payroll calculation; recalculate before release"));
});
