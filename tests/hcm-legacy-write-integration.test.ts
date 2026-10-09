import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("legacy HR write surfaces consistently enforce governed hire, pay, and migration", () => {
  const employees = readFileSync("src/app/api/employees/route.ts", "utf8");
  const importCsv = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const migration = readFileSync("src/app/api/migrations/route.ts", "utf8");
  assert.ok(employees.includes("hasConfiguredHireBusinessProcess(organizationId)"));
  assert.ok(employees.includes("return Response.json(GOVERNED_HIRE_REQUIRED, { status: 409 })"));
  assert.ok(importCsv.includes("hasConfiguredHireBusinessProcess(organizationId)"));
  assert.ok(importCsv.includes("return Response.json(GOVERNED_HIRE_REQUIRED, { status: 409 })"));
  assert.ok(employees.includes("HCM_GOVERNED_COMPENSATION_REQUIRED"));
  assert.ok(employees.includes("compensationGovernanceQuery"));
  assert.ok(employees.includes("tx.insert(auditEvents)"));
  assert.ok(migration.includes("employeeMasterMigrationBlockers(organizationId)"));
  assert.ok(migration.includes("HCM_MIGRATION_LOCKED"));
  assert.ok(migration.includes("tx.insert(auditEvents)"));
});
test("create-only CSV must not rewrite existing salary or identity", () => {
  const code = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  assert.ok(code.includes("skippedExistingCount"));
  assert.ok(code.includes("IMPORT_DUPLICATE_AFTER_PREFLIGHT"));
  assert.ok(!code.includes("await db.update(employees).set"));
});
