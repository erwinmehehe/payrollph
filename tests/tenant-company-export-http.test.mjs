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
test("CSV proof validates the full schema and rejects foreign rows, HTML and public cache", () => {
  // Use the exact production header, independently of the proof helper.
  const header = "Employee no.,Name,Title,Status,Type,Basic rate";
  const csv = (...rows) => [header, ...rows].join("\n");
  const own = {
    status: 200, type: "text/csv; charset=utf-8",
    text: csv("OWN,Owned,Developer,Active,Regular,20000"),
    cache: "private, no-store", nosniff: "nosniff",
  };
  proveEmployeeExport(own, "OWN", "VICTIM");
  assert.throws(() => proveEmployeeExport({
    ...own, text: "Employee no.\nOWN\nVICTIM",
  }, "OWN", "VICTIM"), /employee CSV header missing/);
  assert.throws(() => proveEmployeeExport({
    ...own, text: "Employee no.,Name\nOWN,Owned",
  }, "OWN", "VICTIM"), /employee CSV header missing/);
  assert.throws(() => proveEmployeeExport({
    ...own, text: "Employee no.,Title,Name,Status,Type,Basic rate\nOWN,Owned",
  }, "OWN", "VICTIM"), /employee CSV header missing/);
  proveEmployeeExport({
    ...own, text: csv('OWN-OTHER,"OWN display name",Developer,Active,Regular,20000'),
  }, "OWN-OTHER", "OWN");
  assert.throws(() => proveEmployeeExport({
    ...own, text: csv('"VICTIM",foreign,Developer,Active,Regular,20000',
      "OWN,mine,Developer,Active,Regular,20000"),
  }, "OWN", "VICTIM"), /accepts another employer's data/);
  assert.throws(() => proveEmployeeExport({
    ...own, text: csv("OWN,Owned,Developer,Active,Regular,20000",
      "VICTIM,Victim,Developer,Active,Regular,20000"),
  }, "OWN", "VICTIM"), /accepts another employer's data/);
  // A secondary legal employer's identifier may legitimately contain the
  // primary marker as a prefix; only the full first CSV field is an ID.
  const secondary = {
    ...own, text: csv("OWN-OTHER,OWN-OTHER,Developer,Active,Regular,20000"),
  };
  proveEmployeeExport(secondary, "OWN-OTHER", "OWN");
  assert.throws(() => proveEmployeeExport(
    secondary, "OWN-OTHER", "OWN-OTHER"), /accepts another employer's data/);
  assert.throws(() => proveEmployeeExport(
    secondary, "OWN", "VICTIM"), /missing genuine own employee/);
  assert.throws(() => proveEmployeeExport({ ...own, type: "text/html" }, "OWN", "VICTIM"));
  assert.throws(() => proveEmployeeExport({ ...own, text: header }, "OWN", "VICTIM"));
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
