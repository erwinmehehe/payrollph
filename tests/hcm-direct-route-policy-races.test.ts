import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("BP definition mutations share a policy lock with direct route checks", () => {
  const source = readFileSync("src/app/api/hcm/business-processes/definitions/route.ts", "utf8");
  assert.equal((source.match(/pg_advisory_xact_lock\(4195/g) ?? []).length, 3);
});

test("published plan cannot skip configured HCM create-position review", () => {
  const source = readFileSync("src/app/api/workforce-planning/position-executions/route.ts", "utf8");
  assert.match(source, /createsApprovedPosition/);
  assert.match(source, /action\.kind === "create"/);
  assert.match(source, /pg_advisory_xact_lock\(4195/);
  assert.match(source, /hcmBusinessProcessDefinitions\.processType, "create_position"/);
  assert.match(source, /POSITION_EXECUTION_GOVERNED_REVIEW_REQUIRED/);
});

test("standalone employee create rechecks Hire governance and inserts pay profile atomically", () => {
  const source = readFileSync("src/app/api/employees/route.ts", "utf8");
  assert.match(source, /const createdOrDenied = await db\.transaction/);
  assert.match(source, /pg_advisory_xact_lock\(4212/);
  assert.match(source, /pg_advisory_xact_lock\(4195/);
  assert.match(source, /eq\(hcmBusinessProcessDefinitions\.processType, "hire"\)/);
  assert.match(source, /await tx\.insert\(employees\)/);
  assert.match(source, /await tx\.insert\(employeePayProfiles\)/);
  assert.match(source, /EMPLOYEE_NO_CONCURRENT_CONFLICT/);
});

test("CSV intake rechecks HCM Hire governance under tenant intake lock", () => {
  const route = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const handler = readFileSync("src/lib/employee-import-request.ts", "utf8");
  const commit = readFileSync("src/lib/employee-import-batch-server.ts", "utf8");
  const preview = readFileSync("src/lib/employee-import-preview.ts", "utf8");
  assert.match(route, /handleEmployeeImportPreview\(/);
  assert.match(handler, /commitEmployeeImport\(/);
  assert.match(commit, /pg_advisory_xact_lock\(4212/);
  assert.match(commit, /pg_advisory_xact_lock\(4195/);
  assert.match(commit, /eq\(hcmBusinessProcessDefinitions\.processType, "hire"\)/);
  assert.match(handler, /error\.message === "HCM_GOVERNED_HIRE_REQUIRED"/);
  assert.match(commit, /readEmployeeImportContext\(input\.organizationId, tx\)/,
    "Recheck existing numbers within the locked transaction");
  assert.match(preview, /known\.has\(normalized\)/,
    "Existing employees must be rejected, never updated");
});
