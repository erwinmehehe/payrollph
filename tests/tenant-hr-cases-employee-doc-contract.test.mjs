import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, refuseUnsafeHrEmployeeDoc, verifyHrEmployeeDocPins,
  assertOwnedDocument, assertDeniedPrivate, assertUnchanged,
} from "../scripts/qa/tenant-hr-cases-employee-doc-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_HR_CASE_PAGE_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  EMPLOYEE_HR_CASES_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
  EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const response = (status, text, type = "text/plain; charset=utf-8") => ({
  status, text, headers: new Headers({
    "content-type": type, "cache-control": "private, no-store",
  }),
});

test("HR employee and COE proof refuses provider secrets, hosted DB and active money", () => {
  assert.equal(refuseUnsafeHrEmployeeDoc(safe), true);
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://prod.example.invalid/app_db" },
    { MULTI_ENTITY_ENABLED: "true" }, { EMPLOYEE_HR_CASES_ENABLED: "false" },
    { EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true" }, { WORKER_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { S3_ACCESS_KEY_ID: "real" },
    { R2_BUCKET: "real" }, { NEON_DATABASE_URL: "production" },
  ]) assert.throws(() => refuseUnsafeHrEmployeeDoc({ ...safe, ...change }),
    /REFUSED/, JSON.stringify(change));
});

test("source pins reject any changed HR case, document, auth, or staff UI source", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 10);
  assert.doesNotThrow(() => verifyHrEmployeeDocPins());
  for (const file of Object.keys(SOURCE_PINS)) {
    assert.throws(() => verifyHrEmployeeDocPins(path =>
      path === file ? Buffer.concat([readFileSync(path), Buffer.from("\n// changed")])
        : readFileSync(path)), /source drift/, file);
  }
});

test("document positives must contain exact own bytes and denials must not leak", () => {
  const own = "FICTIONAL_APPROVED_COE_OWN";
  assertOwnedDocument(response(200, own), own, ["VICTIM"]);
  for (const bad of [
    response(200, ""), response(200, "FICTIONAL_APPROVED_COE_VICTIM"),
    response(200, own + "VICTIM"), response(404, own),
    response(200, own, "text/html"),
  ]) assert.throws(() => assertOwnedDocument(bad, own, ["VICTIM"]));
  assertDeniedPrivate(response(404, '{"error":"not found"}', "application/json"),
    404, ["VICTIM"], "foreign");
  for (const bad of [
    response(200, own), response(404, own), response(404, "VICTIM", "application/json"),
  ]) assert.throws(() => assertDeniedPrivate(bad, 404, [own, "VICTIM"], "negative"));
  const before = { cases: [1], documents: [1], audit: [] };
  assertUnchanged(before, structuredClone(before), "victim");
  assert.throws(() => assertUnchanged(before, { ...before, audit: [2] }, "victim"));
});

test("the real fixture tests linked employee POST, COE GET, hydrated UI and revocation", () => {
  const script = readFileSync("scripts/qa/tenant-hr-cases-employee-doc-browser.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-hr-cases-employee-coe-browser-qa.yml", "utf8");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.equal(manifest.scopedPages.find(row =>
    row.path === "src/app/hcm/hr-cases/page.tsx")?.status, "GAP");
  for (const marker of [
    "refuseUnsafeHrEmployeeDoc();", "verifyHrEmployeeDocPins();",
    'import("../../src/db/index.ts")', 'import("playwright")',
    "linkedEmployeeOwnPosts:", "forgedEmployerWorkerIgnored: true",
    "actualOwnedCoeDownloads:", "foreignCoeDownloadDenials:",
    "sameSessionRevokedDocumentDenied: true", "realBrowserInternalNotePersisted: true",
    "internalStaffNotesHiddenFromEmployee: true",
    "victimBusinessAndAuditUnchanged: true",
    "documentObjectPuts: 0", "addedMethodCredits: 0", "addedPageCredits: 0",
  ]) assert.ok(script.includes(marker), "Missing real HR privacy proof: " + marker);
  assert.ok(script.indexOf("refuseUnsafeHrEmployeeDoc();") <
    script.indexOf('import("../../src/db/index.ts")'));
  for (const marker of [
    "playwright@1.55.0", "npx playwright install --only-shell chromium",
    "tenant-hr-cases-employee-doc-browser.mjs",
    "image: postgres:16", "git rev-parse HEAD",
  ]) assert.ok(workflow.includes(marker), "Missing CI gate " + marker);
});
