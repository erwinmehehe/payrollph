/**
 * Independent source-bound, disposable-PG16 verification for the HCM Team Leave
 * Calendar page and read API. No API or page-coverage credits are awarded.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE_PATH = "/hcm/team-leave-calendar";
export const API_PATH = "/api/hcm/team-leave-calendar";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/team-leave-calendar/page.tsx": "bcf78f9ebc733ee6236852960eb46e32c020e272",
  "src/app/api/hcm/team-leave-calendar/route.ts": "c4376755e457b84dc7e7daf1f44005a97a2bab05",
  "src/lib/hcm-team-leave-calendar-server.ts": "39af424570d3fd5343e9fe19ed09bc4940524525",
  "src/lib/hcm-team-leave-calendar-contract.ts": "7361f8157c2acb1a6ef6ea153006ed883215f1fc",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex");
}

export function verifyTeamLeaveSourcePins(root = process.cwd()) {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(resolve(root, path))), expected,
      "TEAM_LEAVE_REFUSED: exact reviewed source changed: " + path);
  }
  const page = readFileSync(resolve(root, "src/app/hcm/team-leave-calendar/page.tsx"), "utf8");
  const api = readFileSync(resolve(root, "src/app/api/hcm/team-leave-calendar/route.ts"), "utf8");
  const server = readFileSync(resolve(root, "src/lib/hcm-team-leave-calendar-server.ts"), "utf8");
  for (const token of ["assertOrganizationRole(", "deriveTeamLeaveScope", "teamLeaveEnabledForEmployer", "getSessionUser", "notFound()"])
    assert.ok(page.includes(token), "TEAM_LEAVE_REFUSED: missing page authorization: " + token);
  for (const token of ["assertOrganizationRole(", "deriveTeamLeaveScope(access)", "teamLeaveEnabledForEmployer(organizationId)", "loadTeamLeaveMonth("])
    assert.ok(api.includes(token), "TEAM_LEAVE_REFUSED: missing read API authorization: " + token);
  for (const token of [
    "eq(leaveRequests.organizationId, organizationId)",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.orgUnitId, scope.orgUnitId)",
    "TEAM_LEAVE_SOURCE_CEILING + 1",
  ]) assert.ok(server.includes(token), "TEAM_LEAVE_REFUSED: missing employer-bound SQL: " + token);
  return true;
}

export function requireDisposableTeamLeaveEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_TEAM_LEAVE_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    HCM_TEAM_LEAVE_CALENDAR_ENABLED: "true",
    HCM_TEAM_LEAVE_CALENDAR_ORG_IDS: "1,2,3",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(required))
    assert.equal(env[name], value, "TEAM_LEAVE_REFUSED: unsafe " + name);
  for (const name of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  ]) assert.ok(!env[name], "TEAM_LEAVE_REFUSED: external credential " + name);
  return true;
}

export function assertNoTenantMarkers(result, forbidden, context) {
  assert.equal(typeof result.text, "string", context + ": missing HTTP body");
  const decoded = result.text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  for (const subject of forbidden) {
    assert.ok(!decoded.includes(subject.marker),
      context + ": disclosed a different employer marker: " + subject.label);
  }
}

export function assertDeniedResponse(result, expectedStatus, forbidden, context) {
  assert.equal(result.status, expectedStatus, context + ": incorrect denial status");
  assertNoTenantMarkers(result, forbidden, context);
  assert.ok(!result.json?.cases, context + ": a denied response cannot contain leave records");
}

export function assertOwnPage(result, subject, forbidden) {
  assert.equal(result.status, 200, "A genuine signed-in employer page must render successfully");
  assert.ok(result.text.includes("Team Leave Calendar"), "An actual page, not an empty 200, must render");
  assert.ok(result.text.includes("organizationId=" + subject.org.id),
    "The rendered page must retain the authorized employer selector");
  assertNoTenantMarkers(result, forbidden, "owned SSR page");
}

export function assertOwnLeaveResponse(result, subject, forbidden, expectedRows, scope, month) {
  assert.equal(result.status, 200, "Two legitimate employers must obtain an HTTP 200");
  assert.ok(result.headers.get("cache-control")?.includes("no-store"), "Sensitive leave response must not be cached");
  const response = result.json;
  assert.equal(response?.organizationId, subject.org.id);
  assert.equal(response?.month, month);
  assert.deepEqual(response?.scope, scope);
  assert.equal(response?.dates?.start, month + "-01");
  assert.ok(response?.dates?.end?.startsWith(month + "-"));
  assert.ok(Array.isArray(response?.cases) && response.cases.length === expectedRows.length,
    "An actual, completely populated and bounded source response is required");
  const expectedIds = expectedRows.map(x => x.id).sort((a, b) => a - b);
  const receivedIds = response.cases.map(x => x.requestId).sort((a, b) => a - b);
  assert.deepEqual(receivedIds, expectedIds, "All and only authorized source leave rows may appear");
  for (const c of response.cases) {
    const row = expectedRows.find(x => x.id === c.requestId);
    assert.ok(row && row.employeeId === c.employeeId && row.status === c.status,
      "Source leave request id, worker and status must all match persisted SQL");
    assert.ok(c.employeeName.includes(subject.marker), "Own employer employee identity required");
    assert.ok(["Pending", "Approved"].includes(c.status));
  }
  assert.equal(response.summary?.approvedRequestRecords,
    expectedRows.filter(x => x.status === "Approved").length);
  assert.equal(response.summary?.pendingRequestRecords,
    expectedRows.filter(x => x.status === "Pending").length);
  assertNoTenantMarkers(result, forbidden, "owned leave response");
  for (const secret of [subject.privateReason, subject.privateType])
    assert.ok(!result.text.includes(secret), "Private leave type/reason must not be returned");
}

export function assertReadOnlySql(before, after, label) {
  assert.deepEqual(after, before, label + ": read request changed protected employer SQL");
}
