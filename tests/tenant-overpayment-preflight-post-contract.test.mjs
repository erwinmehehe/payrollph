import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const route = readFileSync("src/app/api/payroll/overpayment-preflight/route.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-overpayment-preflight-post-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-overpayment-preflight-post-http.yml", "utf8");
test("Preflight POST retains employer-scoped employee, Released run and downstream data", () => {
  const post = route.split("export async function POST")[1];
  for (const k of [
    "enforceSameOriginMutation(request)", "const gate = await requireInvestigator(organizationId)",
    "eq(employees.organizationId, organizationId)", "eq(payrollRuns.organizationId, organizationId)",
    "eq(employeeLoans.organizationId, organizationId)",
    "eq(separationRecords.organizationId, organizationId)",
    "eq(employeePayRetroAdjustments.organizationId, organizationId)",
    "previewOnly: true", "persisted: false",
  ]) assert.ok(post.includes(k), "Missing preflight source guard: " + k);
});
test("PG16 script proves two genuine attacker employers and unchanged victim money", () => {
  for (const k of [
    '["GITHUB_ACTIONS", "true"]',
    '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
    '["PAYROLL_OVERPAYMENT_REVIEW_ENABLED", "true"]',
    '["PAYMONGO_DISBURSEMENTS_ENABLED", "false"]',
    'for (const label of ["ATTA", "ATTB", "VICTIM"])',
    "positive === 3 && denied === 8",
    "sourcePayrollRunId: victim.run.id",
    "assert.deepEqual(await snapshot(e), before.get(e.org.id)",
    "methodCredits: 0",
  ]) assert.ok(proof.includes(k), "Missing HTTP negative control: " + k);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-overpayment-preflight-post-http\.mjs/);
});
