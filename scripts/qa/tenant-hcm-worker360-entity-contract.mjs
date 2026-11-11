/**
 * Fictional PG16/localhost only; neither production acceptance nor API
 * coverage credit is implied by a passing result.
 */
import assert from "node:assert/strict";
export const ORIGIN = "http://127.0.0.1:3000";
export const AS_OF = "2026-07-01";
export function requireIsolatedWorker360(env = process.env) {
  const required = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_WORKER360_ENTITY_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    HCM_WORKER_360_ENABLED: "true",
    HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false", MULTI_ENTITY_ENABLED: "true",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  };
  for (const [key, expected] of Object.entries(required))
    assert.equal(env[key], expected, "WORKER360_ENTITY_REFUSED: unsafe " + key);
  for (const key of [
    "NEON_DATABASE_URL", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
    "SMTP_PASSWORD", "SMTP_URL", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  ]) assert.ok(!env[key], "WORKER360_ENTITY_REFUSED: provider secret " + key);
  return true;
}
export function assertDenied(response, status, markers, label) {
  assert.equal(response.status, status, label + ": exact HTTP denial status");
  assert.ok(!response.json?.worker, label + ": worker leaked");
  assert.ok(!response.json?.employmentEvents, label + ": history leaked");
  for (const marker of markers) {
    assert.ok(!response.text.includes(marker), label + ": private marker leaked");
    assert.ok(!response.text.includes(encodeURIComponent(marker)),
      label + ": encoded private marker leaked");
  }
  assert.ok(!response.headers.get("set-cookie")?.includes("__Host-linaw_session="),
    label + ": denied response minted a login");
}
export function assertReadOnly(before, after, label) {
  assert.deepEqual(after, before, label + ": GET mutated protected SQL");
}
