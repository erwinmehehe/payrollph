import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("M-5 final-pay settled retro only trusts Released same-employee payroll source", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const begin = route.indexOf("const retroSourcePeriods = retroIds.size");
  const end = route.indexOf("const retroSourceYearById =", begin);
  assert.ok(begin > 0 && end > begin, "source year lookup must remain accessible for audit");
  const sourceQuery = route.slice(begin, end);

  assert.match(sourceQuery, /\.leftJoin\(payrollRuns, and\(/, "missing/invalid joins must preserve nulls for fail-closed attribution");
  assert.match(sourceQuery, /eq\(payrollRuns\.organizationId, input\.organizationId\)/);
  assert.match(sourceQuery, /eq\(payrollRuns\.status, "Released"\)/);
  assert.match(sourceQuery, /exists\(reader\.select\(\{ id: payrollEntries\.id \}\)\.from\(payrollEntries\)/);
  assert.match(sourceQuery, /eq\(payrollEntries\.payrollRunId, employeePayRetroAdjustments\.sourcePayrollRunId\)/);
  assert.match(sourceQuery, /eq\(payrollEntries\.employeeId, employeePayRetroAdjustments\.employeeId\)/);
  assert.match(sourceQuery, /eq\(employeePayRetroAdjustments\.employeeId, input\.employeeId\)/);
  assert.doesNotMatch(sourceQuery, /sourcePeriodLabel/, "editable labels must never establish statutory source dates");

  const sourceYear = route.slice(end, route.indexOf("const crossing =", end));
  assert.match(sourceYear, /retroSourceTaxYear\(String\(row\.sourcePeriodStart\), String\(row\.sourcePeriodEnd\)\)/);
  assert.match(readFileSync("src/lib/final-pay.ts", "utf8"), /FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED/);
});
