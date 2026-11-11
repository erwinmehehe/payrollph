/**
 * HR Cases staff-page and read-only inbox tenant proof contract.
 * Fictional exact-head PostgreSQL 16 only; no page/API method credit or
 * production/security acceptance follows from this evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE_PATH = "/hcm/hr-cases";
export const API_PATH = "/api/hr-cases";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/hr-cases/page.tsx": "93ef058a785606fd00921b23b47c73436e308fbb",
  "src/app/api/hr-cases/route.ts": "995420a26af9766d89216ee0ccec93a9d63b1846",
  "src/lib/hr-case-activation.ts": "005c1edfada672f79deecb6f6d9370ea3ccbdee2",
  "src/lib/hr-case-policy.ts": "f54464dd7a001cf8a38be65a8ac1289d61dc2693",
  "src/lib/hr-case-tenant-scope.ts": "1add6e489f0cb3e4c88ffce3aba265f1b38ba374",
  "src/lib/hr-case-queue-read.ts": "791fdf4ff241b288ce8c155748083aa918a770be",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1")
    .update(Buffer.from("blob " + buffer.length + "\0"))
    .update(buffer).digest("hex");
}

export function verifyHrPageSourcePins(root = process.cwd()) {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    const actual = gitBlobSha(readFileSync(resolve(root, path)));
    assert.equal(actual, expected, "HR_CASE_PAGE_REFUSED: source changed: " + path);
  }
  const page = readFileSync(resolve(root, "src/app/hcm/hr-cases/page.tsx"), "utf8");
  const api = readFileSync(resolve(root, "src/app/api/hr-cases/route.ts"), "utf8");
  for (const part of [
    "employeeHrCasesEnabled()", "getSessionUser()", "getAccess(user.id, organizationId)",
    "assertOrganizationRole(user.id, organizationId", "hrCaseRoleCanWork(",
    "notFound()", "EmployeeHrCaseStaffQueue",
  ]) assert.ok(page.includes(part), "HR_CASE_PAGE_REFUSED: missing page gate " + part);
  for (const part of [
    "explicitHrCaseEmployerId(", "assertOrganizationRole(user.id, organizationId",
    "hrCaseStaffRosterScope(", "eq(employeeHrCases.organizationId, organizationId)",
    "hrCaseRoleCanWork(", "visibleHrCaseMessages(",
  ]) assert.ok(api.includes(part), "HR_CASE_PAGE_REFUSED: missing API gate " + part);
  return true;
}

export function requireDisposableHrPageEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_HR_CASE_PAGE_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN,
    SECURITY_SMOKE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    EMPLOYEE_HR_CASES_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "false",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [name, expected] of Object.entries(required))
    assert.equal(env[name], expected, "HR_CASE_PAGE_REFUSED: unsafe " + name);
  for (const name of [
    "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET", "SMTP_PASSWORD", "SMTP_URL",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  ]) assert.ok(!env[name], "HR_CASE_PAGE_REFUSED: provider credential present: " + name);
  return true;
}

function decodedBody(body) {
  return body.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
}
export function assertNoOtherEmployerMarkers(response, subjects, label) {
  assert.equal(typeof response.text, "string", label + ": HTTP response missing");
  const body = decodedBody(response.text);
  for (const actor of subjects) {
    assert.ok(!body.includes(actor.marker),
      label + ": foreign employer data rendered (" + actor.label + ")");
  }
}

export function assertOwnHrPage(response, actor, others) {
  assert.equal(response.status, 200, "Own HR Cases SSR must render 200");
  assert.ok(response.text.includes("Employee HR requests"),
    "Own response must render the real HR Cases page");
  assert.ok(response.text.includes("organizationId=" + actor.org.id),
    "Own SSR must preserve the authorized employer selector");
  assertNoOtherEmployerMarkers(response, others, "own HR Cases SSR");
}

export function assertOwnHrCases(response, actor, others, expectedRows) {
  assert.equal(response.status, 200, "Own populated HR inbox must return 200");
  assert.ok(response.headers.get("cache-control")?.includes("no-store"),
    "HR case response must be non-cacheable");
  assert.equal(response.json?.organizationId, actor.org.id);
  assert.ok(Array.isArray(response.json.cases), "Missing real case array");
  const actual = response.json.cases;
  assert.deepEqual(actual.map(x => x.id).sort((a,b) => a-b),
    expectedRows.map(x => x.id).sort((a,b) => a-b),
    "Returned exact owned case IDs, no empty or padded response");
  for (const got of actual) {
    const row = expectedRows.find(x => x.id === got.id);
    assert.ok(row, "Unexpected case ID");
    assert.equal(got.organizationId, actor.org.id);
    assert.equal(got.employeeId, row.employeeId);
    assert.equal(got.caseType, row.caseType);
    assert.equal(got.assignedRole, row.assignedRole);
    assert.equal(got.subject, row.subject);
    assert.equal(got.status, row.status);
    assert.ok(got.employeeName?.includes(actor.marker),
      "Actual own worker identity must be joined from the selected employer");
    assert.ok(Array.isArray(got.messages) && got.messages.length === 1,
      "Own real case must include exactly its persisted message");
    assert.ok(got.messages[0].body.includes(actor.marker));
    assert.equal(typeof got.sla?.hoursRemaining, "number");
  }
  assertNoOtherEmployerMarkers(response, others, "own HR inbox");
}

export function assertDeniedHrResponse(response, status, allActors, context) {
  assert.equal(response.status, status, context + ": incorrect refusal status");
  assertNoOtherEmployerMarkers(response, allActors, context);
  assert.ok(!response.json?.cases, context + ": denied inbox returned private cases");
}

export function assertReadOnlySql(before, after, label) {
  assert.deepEqual(after, before, label + ": GET/SSR changed protected SQL");
}
