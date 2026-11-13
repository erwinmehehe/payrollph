/** Negative proof controls: fake successes, source drift and unsafe targets fail. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, requireDisposableExportEnv, verifyExportSourcePins,
  assertOwnPreview, assertOwnCsv, assertDeniedExport, assertProtectedUnchanged,
} from "../scripts/qa/tenant-report-builder-export-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  DEMO_MODE: "false", BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_REPORT_EXPORT_PROOF: "fictional-pg16-only",
  TENANT_REPORT_BUILDER_ENABLED: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
};
const actor = { unit: { code: "OWN-DEPT" } };
const victim = {
  marker: "SECRET-VICTIM",
  org: { name: "PRIVATE VICTIM INC" }, worker: { employeeNo: "V-123" },
};
const response = (status, text, contentType, extra = {}) => ({
  status, text, json: contentType.includes("json") ? JSON.parse(text) : null,
  headers: new Headers({ "content-type": contentType, "cache-control": "no-store", ...extra }),
});

test("acceptance runner refuses production, real providers and remote DBs", () => {
  assert.doesNotThrow(() => requireDisposableExportEnv(safe));
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { DEMO_MODE: "true" }, { TENANT_REPORT_EXPORT_PROOF: "production" },
    { TENANT_REPORT_BUILDER_ENABLED: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@public.example.invalid/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/real_payroll" },
    { APP_BASE_URL: "https://public.example.invalid" },
    { WORKER_ENABLED: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { OPENAI_API_KEY: "live-unexpected" }, { XENDIT_SECRET_KEY: "live-unexpected" },
  ]) assert.throws(() => requireDisposableExportEnv({ ...safe, ...patch }),
    /REPORT_EXPORT_REFUSED/);
});

test("every selected production authorization, report, schema and fixture source is pinned", () => {
  assert.doesNotThrow(() => verifyExportSourcePins());
  assert.equal(Object.keys(SOURCE_PINS).length, 11);
  for (const target of Object.keys(SOURCE_PINS)) {
    assert.throws(() => verifyExportSourcePins(path => path === target
      ? Buffer.concat([readFileSync(path), Buffer.from("\n// unreviewed change")])
      : readFileSync(path)), /source drift/, target);
  }
});

test("only populated own-tenant JSON and real CSV bytes can count as positives", () => {
  const goodJson = response(200, JSON.stringify({
    source: "people", columns: ["department", "headcount"], rows: [["OWN-DEPT", "2"]],
  }), "application/json");
  assertOwnPreview(goodJson, actor, victim);
  for (const bad of [
    response(200, "{}", "application/json"),
    response(200, JSON.stringify({ source: "people", columns: ["department", "headcount"],
      rows: [] }), "application/json"),
    response(200, JSON.stringify({ source: "people", columns: ["department", "headcount"],
      rows: [["OTHER-DEPT", "2"]] }), "application/json"),
    response(200, JSON.stringify({ source: "people", columns: ["department", "headcount"],
      rows: [["OWN-DEPT", "2"], [victim.marker, "1"]] }), "application/json"),
  ]) assert.throws(() => assertOwnPreview(bad, actor, victim));
  assertOwnCsv(response(200, "department,headcount\nOWN-DEPT,2\n",
    "text/csv; charset=utf-8", { "content-disposition": "attachment; filename=report.csv" }), actor, victim);
  for (const bad of [
    response(200, "department,headcount\n", "text/csv",
      { "content-disposition": "attachment" }),
    response(200, "department,headcount\n" + victim.marker, "text/csv",
      { "content-disposition": "attachment" }),
    response(200, "<html>OWN-DEPT</html>", "text/html",
      { "content-disposition": "attachment" }),
  ]) assert.throws(() => assertOwnCsv(bad, actor, victim));
});

test("denial controls reject fake 200, partial data and victim marker disclosure", () => {
  assertDeniedExport(response(403, '{"error":"denied"}', "application/json"), victim, "denied");
  for (const bad of [
    response(200, '{"error":"denied"}', "application/json"),
    response(403, JSON.stringify({ error: "denied", rows: [] }), "application/json"),
    response(403, JSON.stringify({ error: victim.marker }), "application/json"),
  ]) assert.throws(() => assertDeniedExport(bad, victim, "denied"));
  assertProtectedUnchanged({ audit: [1], wages: [2] }, { audit: [1], wages: [2] }, "victim");
  assert.throws(() => assertProtectedUnchanged(
    { audit: [1], wages: [2] }, { audit: [1, 3], wages: [2] }, "victim"));
});

test("proof requires real POST, own/foreign/revoked/audit controls and zero new credits", () => {
  const runner = readFileSync("scripts/qa/tenant-report-builder-export-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-report-builder-export-qa.yml", "utf8");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const marker of [
    "requireDisposableExportEnv();", "verifyExportSourcePins();",
    'import("../../src/db/index.ts")', "seedEmployer(\"ATTA\"", "seedEmployer(\"ATTB\"",
    "seedEmployer(\"VICTIM\"", "assertOwnPreview", "assertOwnCsv",
    "assertDeniedExport", "snapshot(victim.org.id)", "active: false",
    "ownCsvAuditRecorded: true", "addedApiCredits: 0", "addedPageCredits: 0",
  ]) assert.ok(runner.includes(marker), "Missing true POST proof requirement: " + marker);
  assert.ok(runner.indexOf("requireDisposableExportEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "No application/database import before disposable-target verification");
  for (const marker of [
    "image: postgres:16", "git rev-parse HEAD",
    "npm run build", "apply-isolated-baseline.mjs",
    "node --import tsx scripts/qa/tenant-report-builder-export-http.mjs",
  ]) assert.ok(workflow.includes(marker), "Missing exact-head fictional PG16 gate: " + marker);
  assert.equal(manifest.scopedPages.find(p =>
    p.path === "src/app/workspace/report-builder/page.tsx")?.status, "GAP",
  "Page must remain uncredited pending complete independent review");
});
