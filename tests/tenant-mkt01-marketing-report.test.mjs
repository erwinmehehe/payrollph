import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyMkt01Credit } from "../scripts/qa/tenant-mkt01-marketing-credit.mjs";
import test from "node:test";
import {
  requireDisposableMkt01, assertMkt01Aggregate, assertMkt01Denied,
  assertMkt01Unchanged, MKT01_ROUTE, MKT01_ROUTE_SHA,
  MKT01_REPORT, MKT01_REPORT_SHA, MKT01_ALLOWLIST,
} from "../scripts/qa/tenant-mkt01-marketing-report-contract.mjs";

const runnerPath = "scripts/qa/tenant-mkt01-marketing-report-http.mjs";
const workflowPath = ".github/workflows/tenant-mkt01-marketing-report-http.yml";
function blobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function safeEnv() {
  return {
    CI: "true", GITHUB_ACTIONS: "true",
    TENANT_MKT01_MODE: "fictional-pg16-http",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    NODE_ENV: "production", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    APP_BASE_URL: "https://payroll.example.test",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    MARKETING_REPORT_EMAILS: MKT01_ALLOWLIST,
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    NEXT_CSP_ENABLED: "false", MULTI_ENTITY_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED: "false",
    CALCULATION_HISTORY_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
    PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
    XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "",
    POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
  };
}

test("MKT-01 refuses external databases, alternate mailboxes and live providers before any import", () => {
  const good = safeEnv();
  assert.equal(requireDisposableMkt01(good), true);
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["TENANT_MKT01_MODE", "untrusted"], ["TENANT_SECOND_PASS_MODE", ""],
    ["NODE_ENV", "development"], ["DEMO_MODE", "true"],
    ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["MARKETING_REPORT_EMAILS", "real-person@example.com"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.private:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/live"],
    ["APP_BASE_URL", "https://example.com"],
    ["SECURITY_SMOKE_URL", "https://remote.example"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["WORKER_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["NEXT_CSP_ENABLED", "true"], ["MULTI_ENTITY_ENABLED", "true"],
    ["CALCULATION_HISTORY_ENABLED", "true"],
    ["PAYROLL_CALCULATION_HISTORY_ENABLED", "true"],
    ["RESEND_API_KEY", "live"], ["STRIPE_SECRET_KEY", "live"],
    ["SMTP_URL", "smtp://remote.example"],
  ]) assert.throws(() => requireDisposableMkt01({ ...good, [key]: value }),
    /MKT01_REFUSED/, key + " must fail closed");
  assert.throws(() => requireDisposableMkt01({}), /MKT01_REFUSED/);
});

test("MKT-01 negative and aggregate contracts refuse wrong status, PII and DB mutations", () => {
  const denied = { status: 403, text: '{"error":"Not allowed"}',
    json: { error: "Not allowed" } };
  assert.equal(assertMkt01Denied(denied, 403).status, 403);
  assert.throws(() => assertMkt01Denied({ ...denied, status: 200 }, 403));
  assert.throws(() => assertMkt01Denied({ ...denied,
    json: { error: "No", totalRequests: 7 } }, 403));
  const report = {
    periodDays: 7, since: new Date().toISOString(), totalRequests: 3,
    attributedRequests: 3, unattributedRequests: 0,
    byRequestType: [{ key: "demo", count: 2 }, { key: "trial", count: 1 }],
    byLandingPath: [], bySourceMedium: [], byCampaign: [],
    byHeadcount: [], byDay: [],
    privacy: "Aggregated report only. No prospect PII.",
  };
  const response = { status: 200, json: report, text: JSON.stringify(report) };
  assert.equal(assertMkt01Aggregate(response, { days: 7, total: 3, attributed: 3 }).totalRequests, 3);
  assert.throws(() => assertMkt01Aggregate(response, { days: 7, total: 5, attributed: 3 }));
  assert.throws(() => assertMkt01Aggregate({ ...response,
    text: response.text + "someone@example.test" },
    { days: 7, total: 3, attributed: 3 }, ["someone@example.test"]));
  assert.throws(() => assertMkt01Unchanged({ leads: [1] }, { leads: [2] }, "victim"));
});

test("MKT-01 targets precisely the existing platform marketing report, not a tenant-private covered method", () => {
  const route = readFileSync(MKT01_ROUTE);
  const report = readFileSync(MKT01_REPORT);
  assert.equal(blobSha(route), MKT01_ROUTE_SHA, "route changed: source review required");
  assert.equal(blobSha(report), MKT01_REPORT_SHA, "aggregation changed: source review required");
  const endpoint = route.toString();
  for (const proof of [
    "getSessionUser()", "MARKETING_REPORT_EMAILS",
    "allowed.has(user.email.toLowerCase())",
    "requireSensitiveActionMfa(user)",
    "marketingLeadReport(Number.isFinite(daysParam) ? daysParam : 90)",
    "Aggregated report only.",
  ]) assert.ok(endpoint.includes(proof), "operator-only guard changed: " + proof);
  const aggregator = report.toString();
  for (const field of [
    "marketingLeads.kind", "marketingLeads.headcount",
    "marketingLeads.attribution", "marketingLeads.createdAt",
    "Math.max(1, Math.min(Math.trunc(days), 365))", ".limit(5000)",
  ]) assert.ok(aggregator.includes(field), "aggregate boundary changed: " + field);
  for (const forbidden of [
    "marketingLeads.name", "marketingLeads.email", "marketingLeads.company",
    "marketingLeads.notes",
  ]) assert.ok(!aggregator.includes(forbidden), "report queries raw prospect PII: " + forbidden);
  const ledger = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const method = ledger.allApiRouteFiles[MKT01_ROUTE]?.methods.find(m => m.name === "GET");
  assert.equal(method?.status, "COVERED", "operator-only aggregate is credited but not public");
  assert.equal(method?.testedBy?.operatorScoped, true);
  assert.equal(method?.testedBy?.publicByDesign, false);
  assert.equal(method?.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(method?.reviewedUncertified, undefined);
  assert.equal(verifyMkt01Credit(), 1, "source-pinned receipt and generated manifest/closure docs");
  assert.match(ledger.acceptanceStatus, /^NOT ACCEPTED:/);
});

test("MKT-01 runner is isolated, DB-backed, adversarial and read-only", () => {
  const source = readFileSync(runnerPath, "utf8");
  assert.ok(source.indexOf("requireDisposableMkt01();") <
    source.indexOf('import("../../src/db/index.ts")'),
    "guard must run before opening DB");
  for (const marker of [
    "SHOW server_version_num", '"ATTA"', '"ATTB"', '"VICTIM"',
    "marketing_leads", "user_organizations", "mfa_verified_at",
    "revoked_at", "assertMkt01Denied", "assertMkt01Aggregate",
    "assertMkt01Unchanged", "newCoverageCredits: 0",
    "const authorizedB = await auditedGet(", "const forgedUrl = PATH +",
    "assert.deepEqual(stableAggregate(forgedReport)",
    "twoIndependentOperatorSuccesses: true",
    "forgedHigherIdSelectorsIgnored: true",
    "forgedQueryHeaderCookieEmployerBusinessLegalEmployerEmailIgnored: true",
    "emptyAndUnsetAllowlist503: true",
    "perRequestDurableRowsUnchanged: true",
    "independentSecurityReview: \"PENDING\"",
  ]) assert.ok(source.includes(marker), "MKT-01 proof check missing: " + marker);
  for (const marker of [
    "employerId:", "businessId:", "legalEmployerId:", "email: victim.email",
    "forgedHeaders", "forgedCookie", '["-999", 1, 0]',
    '["NaN", 90, 3]', '["1000000000000", 365, 3]',
    'disabledAllowlistServer("empty", 3001)',
    'disabledAllowlistServer("unset", 3002)',
    "const justBefore = await state();",
    "assertMkt01Unchanged(justBefore, await state()",
  ]) assert.ok(source.includes(marker), "missing adversarial probe: " + marker);
  assert.ok(!source.includes("https://api."), "no external provider calls allowed");
});

test("MKT-01 workflow only runs standalone fictional PG16, no money or scheduled workers", () => {
  const source = readFileSync(workflowPath, "utf8");
  for (const marker of [
    "postgres:16", "npm ci", "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs", "npm run build",
    "npm start -- -H 127.0.0.1",
    "tenant-mkt01-marketing-report-http.mjs",
    "tenant-mkt01-marketing-report.test.mjs",
    "PAYMONGO_DISBURSEMENTS_ENABLED: 'false'",
    "XENDIT_BILLING_ENABLED: 'false'",
    "WORKER_ENABLED: 'false'", "CENTRAL_SCHEDULER_ENABLED: 'false'",
    "permissions:", "contents: read", "persist-credentials: false",
  ]) assert.ok(source.includes(marker), "unsafe or incomplete workflow: " + marker);
  assert.ok(!source.includes("workflow_dispatch:"),
    "do not allow manual execution against arbitrary environments");
});
