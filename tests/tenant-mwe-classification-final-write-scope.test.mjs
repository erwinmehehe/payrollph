import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/mwe-classification.ts", "utf8");
const decision = source.slice(source.indexOf("export async function decideMweClassificationRequest"));

test("MWE classification approve/reject final SQL includes authorized employer", () => {
  assert.equal((decision.match(/eq\(employeeMweClassifications.id, request.id\),\s*eq\(employeeMweClassifications.organizationId, input.organizationId\),\s*eq\(employeeMweClassifications.status, "pending"\)/g) ?? []).length, 2);
  assert.match(decision, /eq\(employeeMweClassifications.id, latest.id\),\s*eq\(employeeMweClassifications.organizationId, input.organizationId\)/);
  assert.match(decision, /where id = \$\{input.classificationId\} and organization_id = \$\{input.organizationId\}/);
});

test("MWE decisions scope dependent payroll and approval writes to same employer", () => {
  assert.match(decision, /eq\(payrollRuns.id, run.id\),\s*eq\(payrollRuns.organizationId, input.organizationId\)/);
  assert.match(decision, /eq\(approvalTasks.payrollRunId, run.id\),\s*eq\(approvalTasks.organizationId, input.organizationId\),\s*inArray\(approvalTasks.status, \["Pending", "Approved"\]\)/);
  assert.match(decision, /eq\(payrollRuns.organizationId, input.organizationId\)/);
  assert.match(decision, /eq\(employees.organizationId, input.organizationId\)/);
});

test("MWE maker-checker and transaction audit guards are preserved", () => {
  assert.ok(decision.includes("return db.transaction(async (tx) => {"));
  assert.ok(decision.includes("if (request.requestedByUserId === input.decidedByUserId)"));
  assert.ok(decision.includes("await tx.insert(auditEvents).values({"));
});
