import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  REPORT_PAGE_ORIGIN, requireDisposableReportPageEnv, assertOwnReportPage,
  assertForeignReportPage, assertOwnReportCapabilities, assertDeniedReportCapabilities,
  assertReadOnlyReportSnapshot,
} from "../scripts/qa/tenant-report-builder-page-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_REPORT_PAGE_PROOF: "fictional-only", TENANT_REPORT_BUILDER_ENABLED: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: REPORT_PAGE_ORIGIN, TRUSTED_APP_ORIGINS: REPORT_PAGE_ORIGIN,
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};
const actor = {
  label: "ATTA",
  org: { id: 12, name: "TTBL-ATTA-100 employer" },
  worker: { employeeNo: "TTBL-ATTA-100" },
};
const victim = {
  label: "VICTIM",
  org: { id: 20, name: "TTBL-VICTIM-100 employer" },
  worker: { employeeNo: "TTBL-VICTIM-100" },
};
const page = (text, status = 200) =>
  ({ status, text, contentType: "text/html; charset=utf-8" });
const capability = (json, status = 200) => ({
  status, json, text: JSON.stringify(json), contentType: "application/json",
});

test("feature-ON proof refuses production, hosted DBs, providers and background jobs", () => {
  assert.doesNotThrow(() => requireDisposableReportPageEnv(safe));
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "production" },
    { TENANT_REPORT_PAGE_PROOF: "real" },
    { TENANT_REPORT_BUILDER_ENABLED: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@remote.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { APP_BASE_URL: "https://payroll.example.invalid" },
    { TRUSTED_APP_ORIGINS: "https://payroll.example.invalid" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "not-allowed" },
    { XENDIT_SECRET_KEY: "not-allowed" },
    { RESEND_API_KEY: "not-allowed" },
    { OPENAI_API_KEY: "not-allowed" },
  ]) {
    assert.throws(() => requireDisposableReportPageEnv({ ...safe, ...change }),
      /REPORT_PAGE_REFUSED/, JSON.stringify(change));
  }
});

test("positive own SSR requires real employer marker and report content", () => {
  const own = page("<p>Employer: " + actor.org.name + "</p><h1>Custom reports</h1>");
  assertOwnReportPage(own, actor, victim);
  assert.throws(() => assertOwnReportPage(page("Custom reports"), actor, victim));
  assert.throws(() => assertOwnReportPage(page("Custom reports " + victim.org.name),
    actor, victim));
  assert.throws(() => assertOwnReportPage(page("Custom reports " + actor.org.name, 404),
    actor, victim));
});

test("foreign and revoked pages require actual 404 with no private employer or worker markers", () => {
  assertForeignReportPage(page("Not found", 404), victim, "foreign");
  assert.throws(() => assertForeignReportPage(page("Generic 200", 200), victim, "foreign"));
  assert.throws(() => assertForeignReportPage(
    page("Not found " + victim.worker.employeeNo, 404), victim, "revoked"));
});

test("API own field catalog is nonempty and foreign denial never includes capabilities", () => {
  const owned = capability({ fields: { people: ["headcount"], time: [], payroll: [] } });
  assertOwnReportCapabilities(owned, victim, "owned");
  assert.throws(() => assertOwnReportCapabilities(capability({ fields: {} }), victim, "owned"));
  assert.throws(() => assertOwnReportCapabilities(
    capability({ fields: { people: [], time: [], payroll: [] } }), victim, "owned"));
  const denied = capability({ error: "You do not have access to this workspace." }, 403);
  assertDeniedReportCapabilities(denied, 403, victim, "foreign");
  assert.throws(() => assertDeniedReportCapabilities(owned, 403, victim, "foreign"));
  assert.throws(() => assertDeniedReportCapabilities(
    capability({ error: "denied", fields: { people: [] } }, 403), 403, victim, "foreign"));
});

test("read-only snapshot detects unauthorized edits, payroll and audit writes", () => {
  const original = { userOrganizations: [{ active: true }], payrollRuns: [{ id: 7 }],
    employees: [{ employeeNo: "OWN" }], auditEvents: [] };
  assertReadOnlyReportSnapshot(original, structuredClone(original), "read");
  for (const key of ["payrollRuns", "employees", "auditEvents"]) {
    const copy = structuredClone(original);
    copy[key].push({ unexpected: true });
    assert.throws(() => assertReadOnlyReportSnapshot(original, copy, "read"));
  }
});

test("the feature-ON page gate precedes client render and its runner is exact-head PG16", () => {
  const source = readFileSync("src/app/workspace/report-builder/page.tsx", "utf8");
  const runner = readFileSync("scripts/qa/tenant-report-builder-page-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-report-builder-page-qa.yml", "utf8");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.equal(manifest.scopedPages.find(p =>
    p.path === "src/app/workspace/report-builder/page.tsx")?.status, "GAP",
  "Do not promote a page/action GAP from this focused GET-only proof");
  for (const marker of [
    "getSessionUser()", "criticalReleaseFlagEnabled(\"tenantReportBuilder\")",
    "explicitReportBuilderEmployerId(params.organizationId)",
    "getAccess(user.id, organizationId)",
    "roleAllowed(access.role, PEOPLE_PAYROLL_ROLES)",
    "assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES)",
    "if (denied) notFound()", "employer.name",
  ]) assert.ok(source.includes(marker), "Missing server authorization: " + marker);
  assert.ok(source.indexOf("assertOrganizationRole(") <
    source.indexOf("<TenantReportBuilder"), "Do not render report controls before tenant gate");
  assert.ok(runner.indexOf("requireDisposableReportPageEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "Gate must execute before any DB or application module import");
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "standaloneMakeSession", "same signed-in session", "active: false",
    "assertForeignReportPage", "assertDeniedReportCapabilities",
    "assertReadOnlyReportSnapshot", "pageCreditDelta: 0",
  ]) assert.ok(runner.includes(marker), "Missing real HTTP proof: " + marker);
  for (const marker of [
    "image: postgres:16",
    "ref: " + "$" + "{{ github.event.pull_request.head.sha || github.sha }}",
    "git rev-parse HEAD", "TENANT_REPORT_BUILDER_ENABLED: \"true\"",
    "node --test tests/tenant-report-builder-page-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-report-builder-page-http.mjs",
    "apply-isolated-baseline.mjs", "npm run build",
  ]) assert.ok(workflow.includes(marker), "Missing synthetic CI proof: " + marker);
});
