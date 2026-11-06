import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TENANT_TABLE_BASE_ENV } from "../scripts/qa/tenant-table-env.mjs";
import { requireExportProof, proveEmployeeExport } from "../scripts/qa/tenant-company-export-contract.mjs";

test("export acceptance refuses non-CI, remote targets, provider credentials and ambiguous profiles", () => {
  const env = { ...TENANT_TABLE_BASE_ENV, GITHUB_ACTIONS: "true", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", MALWARE_SCAN_URL: "", MALWARE_SCAN_TOKEN: "", PII_ENCRYPTION_KEY: "a".repeat(64),
    TENANT_COMPANY_EXPORT_MODE: "fictional-ci-only", MULTI_ENTITY_ENABLED: "false" };
  requireExportProof(env); requireExportProof({ ...env, MULTI_ENTITY_ENABLED: "true" });
  for (const patch of [{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.invalid:5432/app_db" },
    { SECURITY_SMOKE_URL: "https://example.invalid" }, { RESEND_API_KEY: "live" },
    { DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://example.invalid" }, { MALWARE_SCAN_URL: "https://example.invalid" },
    { MULTI_ENTITY_ENABLED: "yes" }, { TENANT_COMPANY_EXPORT_MODE: "" }])
    assert.throws(() => requireExportProof({ ...env, ...patch }));
});
test("CSV proof rejects a successful HTML login page, foreign rows and public cache", () => {
  const own = { status: 200, type: "text/csv; charset=utf-8", text: "Employee no.\nOWN", cache: "private, no-store", nosniff: "nosniff" };
  proveEmployeeExport(own, "OWN", "VICTIM");
  assert.throws(() => proveEmployeeExport({ ...own, text: "Employee no.\nOWN\nVICTIM" }, "OWN", "VICTIM"), /accepts another employer's data/);
  proveEmployeeExport({ ...own, text: 'Employee no.,Name\nOWN-OTHER,"OWN display name"' }, "OWN-OTHER", "OWN");
  assert.throws(() => proveEmployeeExport({ ...own, text: 'Employee no.,Name\n"VICTIM",foreign\nOWN,mine' }, "OWN", "VICTIM"), /accepts another employer's data/);
  assert.throws(() => proveEmployeeExport({ ...own, type: "text/html" }, "OWN", "VICTIM"));
  assert.throws(() => proveEmployeeExport({ ...own, text: "Employee no." }, "OWN", "VICTIM"));
  assert.throws(() => proveEmployeeExport({ ...own, cache: "public" }, "OWN", "VICTIM"));
});
test("guard precedes database imports and actual HTTP runs independently in both entity profiles", () => {
  const runner = readFileSync(new URL("../scripts/qa/tenant-company-export-http.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("requireExportProof();") < runner.indexOf('import("../../src/db/index.ts")'));
  assert.ok(runner.includes("for (const f of [a, b])"));
  assert.ok(runner.includes("newCoverageCredits: 0"));
  const workflow = readFileSync(new URL("../.github/workflows/tenant-company-export-http.yml", import.meta.url), "utf8");
  assert.match(workflow, /multi-entity: \["false", "true"\]/);
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-company-export-http.mjs"));
  assert.ok(workflow.includes("postgres:16"));
  assert.doesNotMatch(workflow, /secrets\.|NODE_TLS_REJECT_UNAUTHORIZED/);
});

test("synthetic padding is valid and each successful export kind proves private downloads", () => {
  const runner = readFileSync(new URL("../scripts/qa/tenant-company-export-http.mjs", import.meta.url), "utf8");
  assert.match(runner, /legalName: "Fictional padding " \+ i \+ " Inc\."/);
  assert.match(runner, /assert\.match\(payroll\.disposition, \/attachment;/);
  assert.match(runner, /assert\.match\(r\.disposition, \/attachment;/);
  assert.match(runner, /proveEmployeeExport\(granted, f\.otherWorker\.employeeNo, f\.worker\.employeeNo\)/);
  assert.match(runner, /grantedPayroll\.text\.includes\(f\.marker \+ "-SECONDARY"\)/);
});
