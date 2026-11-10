/**
 * Source-sealed, fictional-only SSR tenant-isolation proof for two private HCM
 * pages. A passing test is engineering evidence, never production acceptance.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const MONITOR_PATH = "/hcm/process-monitor";
export const HIRE_PATH = "/hcm/hire-payroll-review";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/process-monitor/page.tsx": "977ae3415144cfa509e709c9a9422d93b6a9f97a",
  "src/lib/hcm-process-monitor-server.ts": "0d2d001e36fa40379f554d376a9ebd8a98221dcd",
  "src/lib/hcm-process-monitor.ts": "fe16b35e185eeea946770c7187ae1f66ca51cc6e",
  "src/app/hcm/hire-payroll-review/page.tsx": "5bc150a6ed9e655d074fecefaa4ba662f4ab41a3",
  "src/lib/hcm-hire-payroll-review-server.ts": "387d28a124db85281ffcfd968c50749a909f4d60",
  "src/lib/hcm-hire-payroll-review.ts": "6cf695a7225d527e7efa96242432be70e8cabada",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
});

export function gitBlobSha(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return createHash("sha1").update(Buffer.from("blob " + b.length + "\0"))
    .update(b).digest("hex");
}

export function verifyHcmPageSources(read = readFileSync) {
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(read(path)), sha,
      "HCM_SSR_REFUSED: source changed; review and rerun the real PG16 proof: " + path);
  }
  const monitor = String(read("src/app/hcm/process-monitor/page.tsx"));
  const hire = String(read("src/app/hcm/hire-payroll-review/page.tsx"));
  const monitorLoader = String(read("src/lib/hcm-process-monitor-server.ts"));
  const hireLoader = String(read("src/lib/hcm-hire-payroll-review-server.ts"));
  for (const needle of [
    "Object.values(query).some(Array.isArray)",
    "assertOrganizationRole(", "getAccess(",
    "canReadHcmProcessMonitor(access)",
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstances.id, selectedProcessId)",
    "if (!ownedProcess) notFound()",
  ]) assert.ok(monitor.includes(needle), "HCM_SSR_REFUSED: monitor boundary removed: " + needle);
  for (const needle of [
    "getSessionUser()", "assertOrganizationRole(", "access?.companyWide",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)", "if (!boundWorker) notFound()",
    "loadHirePayrollInputReview(organizationId, employeeId)",
  ]) assert.ok(hire.includes(needle), "HCM_SSR_REFUSED: hire boundary removed: " + needle);
  for (const needle of [
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstanceSteps.instanceId, selectedProcessId)",
    "MONITOR_STEP_LIMIT + 1",
  ]) assert.ok(monitorLoader.includes(needle),
    "HCM_SSR_REFUSED: monitor SQL isolation removed: " + needle);
  for (const needle of [
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)",
    "eq(employeePayProfiles.organizationId, organizationId)",
    "eq(employeePayProfiles.employeeId, employeeId)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(provisioningTasks.employeeId, employeeId)",
  ]) assert.ok(hireLoader.includes(needle),
    "HCM_SSR_REFUSED: hire SQL isolation removed: " + needle);
  return true;
}

export function requireFictionalHcmEnv(env = process.env) {
  const expected = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_HCM_SSR_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    HCM_PROCESS_MONITOR_ENABLED: "true",
    HCM_PROCESS_MONITOR_ORG_IDS: "8,9,10",
    HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "8,9,10",
    HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
    PILOT_FOCUS_NAV_ENABLED: "false", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, val] of Object.entries(expected))
    assert.equal(env[key], val, "HCM_SSR_REFUSED: unsafe or missing " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "SMTP_PASSWORD", "OPENAI_API_KEY",
    "CRON_SECRET", "WORKER_TOKEN", "MALWARE_SCAN_URL",
    "MALWARE_SCAN_TOKEN", "VERCEL",
  ]) assert.ok(!env[key], "HCM_SSR_REFUSED: live provider or deployment setting " + key);
  return true;
}

export function assertNoTenantLeak(result, employers, label, actor = null) {
  assert.equal(typeof result?.text, "string", label + ": HTTP response required");
  const decoded = result.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const employer of employers) {
    if (employer === actor) continue;
    assert.ok(!decoded.includes(employer.marker),
      label + ": foreign employer marker exposed");
    for (const secret of employer.secrets ?? [])
      assert.ok(!decoded.includes(secret), label + ": foreign private source exposed");
  }
  for (const secret of actor?.secrets ?? [])
    assert.ok(!decoded.includes(secret), label + ": own confidential source projected");
}

// Next SSR inserts React comments between literal and dynamic text. Verify
// visible HTML text, excluding scripts/styles so an RSC payload cannot stand
// in for an actually rendered workflow or worker.
function renderedText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function assertOwnMonitor(result, actor, process, employers) {
  assert.equal(result.status, 200, "Owned monitor must render HTTP 200");
  const text = renderedText(result.text);
  for (const needle of [
    "Business Process Monitor", "Employer #" + actor.org.id,
    "Recorded workflows", "Step timeline",
    "Hire #" + process.id, "Step 1",
  ]) assert.ok(text.includes(needle),
    "Owned monitor must show populated persisted workflow: " + needle);
  assert.ok(!result.text.includes("Workflow source unavailable"),
    "A source-unavailable shell is not own-positive evidence");
  assertNoTenantLeak(result, employers, "owned monitor", actor);
}

export function assertOwnHireReview(result, actor, worker, employers, { payProfilePresent = true } = {}) {
  assert.equal(result.status, 200, "Owned hire evidence must render HTTP 200");
  const text = renderedText(result.text);
  for (const needle of [
    "Hire-to-payroll input evidence", "Employer #" + actor.org.id,
    "Worker #" + worker.id, "Current employment record",
    "Payroll basis and standard hours", "Payroll approval, filing and payout",
  ]) assert.ok(text.includes(needle),
    "Owned hire page must reflect a real persisted worker: " + needle);
  const expectedSourceEvidence = payProfilePresent
    ? "Recognized pay basis and positive rate, work-day and hour fields are recorded; approval is not verified."
    : "An explicit pay profile is missing or its required fields need review.";
  assert.ok(text.includes(expectedSourceEvidence),
    "Owned hire review must distinguish a persisted complete pay profile from a different worker without one");
  assert.ok(!result.text.includes("The input sources are temporarily unavailable"),
    "An unavailable fallback is not an owned data success");
  assertNoTenantLeak(result, employers, "owned hire review", actor);
}

export function assertDeniedPage(result, employers, label) {
  assert.equal(result.status, 404, label + ": fail closed with HTTP 404");
  assertNoTenantLeak(result, employers, label);
  for (const employer of employers) {
    for (const process of employer.processes ?? [])
      assert.ok(!result.text.includes("Hire #" + process.id),
        label + ": denied response rendered an employer process");
  }
}

export function assertSqlUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": read-only SSR changed employer SQL or audit");
}
