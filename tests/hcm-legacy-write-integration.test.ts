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
  assert.match(importCsv, /return Response\.json\(GOVERNED_HIRE_REQUIRED,\s*\{\s*status:\s*409\s*\}\)/);
  assert.ok(importCsv.includes("handleEmployeeImportPreview("));
  assert.ok(employees.includes("HCM_GOVERNED_COMPENSATION_REQUIRED"));
  assert.ok(employees.includes("compensationGovernanceQuery"));
  assert.ok(employees.includes("tx.insert(auditEvents)"));
  assert.ok(migration.includes("employeeMasterMigrationBlockers(organizationId)"));
  assert.ok(migration.includes("HCM_MIGRATION_LOCKED"));
  assert.ok(migration.includes("tx.insert(auditEvents)"));
});
test("create-only CSV must not rewrite existing salary or identity", () => {
  const route = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const batch = readFileSync("src/lib/employee-import-batch-server.ts", "utf8");
  const preview = readFileSync("src/lib/employee-import-preview.ts", "utf8");
  assert.ok(route.includes("handleEmployeeImportPreview("));
  assert.ok(preview.includes("known.has(normalized)"), "Existing staff must fail create-only preview");
  assert.ok(batch.includes("readEmployeeImportContext(input.organizationId, tx)"));
  assert.ok(batch.includes("tx.insert(employees)"));
  assert.ok(!batch.includes("update(employees)"), "CSV commit must not mutate existing staff");
});


test("CSV and initial employee-master imports serialize on one tenant lock", () => {
  const route = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const batch = readFileSync("src/lib/employee-import-batch-server.ts", "utf8");
  const migration = readFileSync("src/app/api/migrations/route.ts", "utf8");
  assert.ok(route.includes("handleEmployeeImportPreview("));
  assert.match(batch, /pg_advisory_xact_lock\(4212/);
  assert.ok(batch.includes("input.organizationId"));
  assert.match(migration, /pg_advisory_xact_lock\(4212/);
  assert.ok(migration.includes("organizationId"));
  assert.ok(!migration.includes("pg_advisory_xact_lock(4213,"));
});
