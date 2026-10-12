import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("flag-off employer CSV entry is preserved while atomic preview requires opt-in", () => {
  const api = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const ui = readFileSync("src/components/import-panel.tsx", "utf8");
  assert.match(api, /const previewEnabled = criticalReleaseFlagEnabled\("employeeImportPreview"\)/);
  assert.match(api, /if \(previewEnabled\)\s*\{/);
  assert.match(api, /return handleEmployeeImportPreview\(/);
  assert.match(api, /const parsed = parseEmployeeCsv\(csv\)/);
  assert.match(api, /await hasConfiguredHireBusinessProcess\(organizationId\)/);
  assert.match(api, /requireSensitiveActionMfa\(user\)/);
  assert.match(api, /if \(!access\?\.companyWide\)/);
  assert.match(ui, /previewEnabled \? <EmployeeImportPreviewPanel/);
  assert.match(ui, /<LegacyImportPanel/);
  assert.match(ui, /Import employees from a spreadsheet/);
  assert.match(ui, /Validate only/);
  assert.match(ui, /\/api\/employees\/import\/template/);
});

test("both flag paths preserve bank encryption and entitlement gates", () => {
  const api = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  const server = readFileSync("src/lib/employee-import-batch-server.ts", "utf8");
  const i = api.indexOf("const gate = requireFeature(entitlements");
  assert.ok(i >= 0);
  assert.match(api, /bankAccount:\s*encryptBankAccount\(row\.bankAccount\)/);
  assert.match(server, /bankAccount:\s*encryptBankAccount\(row\.bankAccount\)/);
  assert.match(server, /pg_advisory_xact_lock\(4212/);
  assert.match(server, /pg_advisory_xact_lock\(4195/);
  assert.match(server, /database\.transaction\(/);
});
