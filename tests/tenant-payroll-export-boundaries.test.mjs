import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const exportsRoute = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
const xenditRoute = readFileSync("src/app/api/payroll-runs/[id]/xendit-payout/route.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-batches/payroll-runs-path-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-payroll-run-path-boundaries.yml", "utf8");

test("payroll exports use canonical IDs while the separately sealed payout route is preserved", () => {
  assert.equal((exportsRoute.match(/canonicalTenantResourceId\(id\)/g) ?? []).length, 2);
  assert.match(xenditRoute, /!Number.isSafeInteger\(runId\) \|\| runId <= 0/);
  assert.match(exportsRoute, /if \(runId === null\)/);

  assert.doesNotMatch(exportsRoute, /const runId = Number\(id\)/);

});

test("ambiguous and malformed explicit payslip selectors cannot widen an export", () => {
  assert.match(exportsRoute, /getAll\(key\)\.length > 1/);
  assert.match(exportsRoute, /\["bank", "government", "payslip", "journal"\]\.includes\(kind\)/);
  assert.match(exportsRoute, /canonicalTenantResourceId\(rawPayslipId\)/);
  assert.match(exportsRoute, /rawPayslipId !== null && \(payslipId === null \|\| kind !== "payslip"\)/);
  assert.match(exportsRoute, /if \(payslipId === null\) \{/);
  assert.doesNotMatch(exportsRoute, /if \(!payslipId\)/);
});

test("both payslip worker associations are checked before exporting anything", () => {
  assert.match(exportsRoute, /\.leftJoin\(employees, eq\(payrollEntries\.employeeId, employees\.id\)\)/);
  const guard = exportsRoute.indexOf("assertPayrollPayslipTenantOwnership(run.organizationId, rows)");
  const listing = exportsRoute.indexOf("return Response.json({ payslips: rows.map(");
  const pdf = exportsRoute.indexOf("return new Response(slip.content");
  assert.ok(guard > 0 && listing > guard && pdf > guard);
  assert.match(exportsRoute, /"Cache-Control": "private, no-store"/);
  assert.match(proof, /mismatched-slip-worker/);
  assert.match(proof, /foreign-entry-worker/);
  assert.match(proof, /PRIVATE-VICTIM-PAYSLIP-/);
  assert.match(proof, /blockedForeignPayslipAssociations: 2/);
});

test("the disposable proof cannot be mistaken for money movement or method credit", () => {
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /profile: \[default, multi-entity\]/);
  assert.match(proof, /requireNoMoneyFixture\(\)/);
  assert.match(proof, /providersContacted: 0, moneyMoved: false/);
  assert.match(proof, /newMethodCredits: 0, productionCertified: false/);
});
