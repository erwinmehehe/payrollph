import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("M-5 final pay uses the transaction-bound verified Released same-employee retro source lookup", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const helper = readFileSync("src/lib/final-pay-retro-source-lookup.ts", "utf8");
  const begin = route.indexOf("const retroSourcePeriods = await loadFinalPayRetroSourcePeriods(");
  const end = route.indexOf("const retroSourceYearById =", begin);
  assert.ok(begin > 0 && end > begin, "source-year verification must remain in the settlement ledger");
  const site = route.slice(begin, end);
  assert.match(site, /organizationId: input\.organizationId/);
  assert.match(site, /employeeId: input\.employeeId/);
  assert.match(site, /adjustmentIds: \[\.\.\.retroIds\]/);
  assert.match(site, /}, reader\)/, "the final-pay transaction reader must be reused");

  assert.match(helper, /\.leftJoin\(payrollRuns, and\(/, "failed source matches must yield null periods, not dropped adjustments");
  assert.match(helper, /eq\(payrollRuns\.organizationId, input\.organizationId\)/);
  assert.match(helper, /eq\(payrollRuns\.status, "Released"\)/);
  assert.match(helper, /exists\(reader\.select\(\{ id: payrollEntries\.id \}\)\.from\(payrollEntries\)/);
  assert.match(helper, /eq\(payrollEntries\.payrollRunId, employeePayRetroAdjustments\.sourcePayrollRunId\)/);
  assert.match(helper, /eq\(payrollEntries\.employeeId, employeePayRetroAdjustments\.employeeId\)/);
  assert.match(helper, /eq\(employeePayRetroAdjustments\.employeeId, input\.employeeId\)/);
  assert.doesNotMatch(helper, /sourcePeriodLabel/, "editable labels cannot authorize statutory source years");

  assert.match(route.slice(end, route.indexOf("const crossing =", end)), /retroSourceTaxYear\(String\(row\.sourcePeriodStart\), String\(row\.sourcePeriodEnd\)\)/);
  assert.match(readFileSync("src/lib/final-pay.ts", "utf8"), /FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED/);
  const fingerprint = readFileSync("src/lib/final-pay-source-fingerprint.ts", "utf8");
  assert.match(fingerprint, /sourcePeriodStart: string \| null; sourcePeriodEnd: string \| null/);
  assert.match(fingerprint, /sourcePeriodStart: row\.sourcePeriodStart === null \? null/);
});
