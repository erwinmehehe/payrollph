/**
 * Disposable, feature-ON Report Builder PAGE proof. Page GAP remains GAP.
 * No production data, payroll mutation, provider access or credit promotion.
 */
import assert from "node:assert/strict";

export const REPORT_PAGE_ORIGIN = "http://127.0.0.1:3000";

export function requireDisposableReportPageEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    DEMO_MODE: "false",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_REPORT_PAGE_PROOF: "fictional-only",
    TENANT_REPORT_BUILDER_ENABLED: "true",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: REPORT_PAGE_ORIGIN,
    TRUSTED_APP_ORIGINS: REPORT_PAGE_ORIGIN,
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required)) {
    assert.equal(env[key], value, "REPORT_PAGE_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "SMTP_PASSWORD", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[key], "REPORT_PAGE_REFUSED: provider credential " + key);
  }
}

export function assertNoReportVictimData(response, victim, label) {
  assert.ok(response && typeof response.text === "string", label + ": real HTTP body required");
  assert.ok(!response.text.includes(victim.org.name),
    label + ": victim employer name disclosed");
  assert.ok(!response.text.includes(victim.worker.employeeNo),
    label + ": victim worker ID disclosed");
}

export function assertOwnReportPage(response, actor, victim) {
  assert.equal(response.status, 200, actor.label + ": own feature-ON report page");
  assert.match(response.contentType, /text\/html/i);
  assert.ok(response.text.includes(actor.org.name),
    "Own page must render a real persisted employer name, not a generic 200 shell");
  assert.ok(response.text.includes("Custom reports"),
    "Own page must render the real report interface");
  assertNoReportVictimData(response, victim, actor.label + " own page");
}

export function assertForeignReportPage(response, victim, label) {
  assert.equal(response.status, 404, label + ": actual foreign employer page must be hidden");
  assertNoReportVictimData(response, victim, label);
}

export function assertOwnReportCapabilities(response, victim, label) {
  assert.equal(response.status, 200, label + ": own real API GET");
  assert.match(response.contentType, /application\/json/i);
  assert.ok(Array.isArray(response.json?.fields?.people) &&
    response.json.fields.people.length > 0,
  "Own real API must return an authorized field catalog, not a generic 200");
  assert.ok(Array.isArray(response.json?.fields?.time) &&
    Array.isArray(response.json?.fields?.payroll));
  assertNoReportVictimData(response, victim, label);
}

export function assertDeniedReportCapabilities(response, status, victim, label) {
  assert.equal(response.status, status, label + ": unauthorized API GET");
  assert.ok(typeof response.json?.error === "string" && response.json.error.length > 0);
  assert.equal(response.json.fields, undefined, "Denied API must not return field capabilities");
  assertNoReportVictimData(response, victim, label);
}

export function assertReadOnlyReportSnapshot(before, after, label) {
  assert.deepEqual(after, before,
    label + ": read-only page/API GET must preserve employer, employee, payroll, memberships and audit");
}
