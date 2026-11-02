import assert from "node:assert/strict";

/**
 * No DB/app import may run before this exact fictional-only refusal.
 * PostgreSQL 16 is created by the dedicated GitHub Actions job.
 */
export function requireDisposableLaborInspection(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_LABOR_INSPECTION_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    MULTI_ENTITY_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required)) {
    assert.equal(env[key], value,
      "LABOR_INSPECTION_PROOF_REFUSED: requires disposable " + key);
  }
  for (const key of [
    "DATABASE_URL_DIRECT", "NEON_DATABASE_URL", "NEON_API_KEY",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "STRIPE_SECRET_KEY", "OPENAI_API_KEY", "VERCEL_ENV",
  ]) {
    assert.ok(!env[key],
      "LABOR_INSPECTION_PROOF_REFUSED: forbids external credential or target " + key);
  }
  assert.equal(env.REQUIRE_PRIVILEGED_MFA, "true",
    "LABOR_INSPECTION_PROOF_REFUSED: MFA must not be bypassed");
}
export const LABOR_INSPECTION_POST = "POST compliance/labor-inspection";

export function assertPrivateDenial(response, expected, markers = []) {
  assert.equal(response.status, expected,
    "real authorization/tenant denial expected: " + response.text.slice(0, 180));
  assert.ok(response.json && typeof response.json.error === "string");
  assert.ok(response.text.length < 1200);
  assert.ok(!/SELECT\s.+FROM|INSERT\s+INTO|stack trace|node_modules|postgresql:/i.test(response.text));
  for (const marker of markers) assert.ok(!response.text.includes(marker),
    "tenant-scoped refusal must not echo a genuine victim marker");
}

export function assertImmutable(otherBefore, otherAfter, label) {
  assert.deepEqual(otherAfter, otherBefore,
    label + ": real non-actor remediation, audits, workers and payroll are immutable");
}
