/**
 * Exact-source, uncredited hire-to-payroll SSR employer/worker boundary proof.
 * No application/DB module is imported by this file.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/hire-payroll-review";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/hire-payroll-review/page.tsx": "5bc150a6ed9e655d074fecefaa4ba662f4ab41a3",
  "src/lib/hcm-hire-payroll-review-server.ts": "387d28a124db85281ffcfd968c50749a909f4d60",
  "src/lib/hcm-hire-payroll-review.ts": "6cf695a7225d527e7efa96242432be70e8cabada",
  "src/lib/hcm-people-home-scope.ts": "b643254e294f56d8fc6687595758acdf19734d49",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/pilot-navigation.ts": "1fe81fc26c16e3a1c147f22c746e0cb1d3f561fb",
  "src/lib/hcm-context-navigation.ts": "cd8f2dc59dc0bddd41beb179cc2cc7429b5cedef",
  "src/components/hcm-context-navigation.tsx": "e2284ab6bf9646e5a7a0155d63c357fc09531a68",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function blobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

export function requireDisposableHireReviewEnv(env = process.env) {
  for (const [key, value] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_HIRE_REVIEW_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
    HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "1,2,3",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  })) assert.equal(env[key], value, "HIRE_REVIEW_REFUSED: unsafe or missing " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN", "MALWARE_SCAN_URL",
    "MALWARE_SCAN_TOKEN",
  ]) assert.ok(!env[key], "HIRE_REVIEW_REFUSED: external credential " + key);
  return true;
}

export function verifyHireReviewSourcePins() {
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(blobSha(readFileSync(path)), sha, "HIRE_REVIEW_REFUSED: source changed " + path);
  }
  const page = readFileSync("src/app/hcm/hire-payroll-review/page.tsx", "utf8");
  const firstAccess = page.indexOf("await assertOrganizationRole(");
  const companyWide = page.indexOf("!access?.companyWide");
  const workerQuery = page.indexOf("const [boundWorker] = await db.select");
  const missing = page.indexOf("if (!boundWorker) notFound();");
  const loader = page.indexOf("loadHirePayrollInputReview(");
  const navigation = page.indexOf("<HcmContextNavigation");
  assert.ok(firstAccess >= 0 && companyWide > firstAccess &&
    workerQuery > companyWide && missing > workerQuery &&
    loader > missing && navigation > missing,
  "HIRE_REVIEW_REFUSED: authorization/worker-binding before private UI required");
  for (const required of [
    "db.select({ id: employees.id })",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)", "if (!boundWorker) notFound();",
  ]) assert.ok(page.includes(required), "HIRE_REVIEW_REFUSED: missing source boundary " + required);
  assert.ok(!page.slice(workerQuery, missing).includes("catch"),
    "HIRE_REVIEW_REFUSED: binding errors must fail closed");
  const loaderSource = readFileSync("src/lib/hcm-hire-payroll-review-server.ts", "utf8");
  for (const required of [
    "eq(employees.organizationId, organizationId)", "eq(employees.id, employeeId)",
    "eq(employeePayProfiles.organizationId, organizationId)",
    "eq(employeePayProfiles.employeeId, employeeId)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(provisioningTasks.employeeId, employeeId)",
  ]) assert.ok(loaderSource.includes(required), "HIRE_REVIEW_REFUSED: data source not scoped");
  return true;
}

export function noPrivateMarkers(html, employers, context) {
  const decoded = html.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  for (const subject of employers) {
    for (const secret of [subject.marker, subject.worker.employeeNo,
      subject.privateBank, subject.privateTax]) {
      if (secret) assert.ok(!decoded.includes(secret),
        context + ": secret employer/worker source exposed");
    }
  }
}

// React SSR can split adjacent text interpolations with empty HTML comments,
// e.g. "Employer #<!-- -->1". Compare visible text without weakening
// the required headings, employer/worker IDs, or secret-marker exclusions.
function visibleSsrText(html) {
  return html.replace(/<!--\s*-->/g, "");
}

export function assertOwnedHirePage(response, actor, worker, employers) {
  assert.equal(response.status, 200, "HIRE_REVIEW: real own worker SSR 200 required");
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const visible = visibleSsrText(response.text);
  for (const value of [
    "Hire-to-payroll input evidence", "Recorded source evidence",
    "Current employment record", "Payroll approval, filing and payout",
    "Employer #" + actor.org.id, "Worker #" + worker.id,
  ]) assert.ok(visible.includes(value), "HIRE_REVIEW: incomplete own SSR " + value);
  assert.ok(!response.text.includes("input sources are temporarily unavailable"),
    "HIRE_REVIEW: own HTTP 200 cannot be the loader-failure fallback");
  noPrivateMarkers(response.text, employers, "own SSR");
}

export function assertDeniedHirePage(response, employers, label) {
  assert.equal(response.status, 404, label + ": hard 404 required");
  const visible = visibleSsrText(response.text);
  for (const subject of employers) {
    assert.ok(!visible.includes("Employer #" + subject.org.id + " · Worker #"),
      label + ": worker binding leaked");
  }
  assert.ok(!response.text.includes("Hire-to-payroll input evidence"),
    label + ": forbidden SSR cannot mount a private worker-specific view");
  noPrivateMarkers(response.text, employers, label);
}
