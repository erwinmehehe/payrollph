import assert from "node:assert/strict";
export function requireDisposableOidcIdentityEnv(env = process.env) {
  assert.equal(env.OIDC_IDENTITY_BINDING_PROOF, "fictional-pg16-only", "OIDC_IDENTITY_REFUSED: explicit fixture mode");
  const url = new URL(env.DATABASE_URL || "about:blank");
  assert.equal(url.protocol, "postgresql:", "OIDC_IDENTITY_REFUSED: PostgreSQL only");
  assert.equal(url.hostname, "127.0.0.1", "OIDC_IDENTITY_REFUSED: loopback only");
  assert.equal(url.pathname, "/tenant_oidc_membership_test", "OIDC_IDENTITY_REFUSED: dedicated empty database only");
  assert.ok(!url.search && !url.hash, "OIDC_IDENTITY_REFUSED: no connection overrides");
  assert.ok(url.port === "55442" || (url.port === "5432" && env.CI === "true" && env.GITHUB_ACTIONS === "true"),
    "OIDC_IDENTITY_REFUSED: dedicated local port or disposable CI service only");
  for (const flag of ["WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "XENDIT_BILLING_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED", "FINAL_PAY_SIGNED_REVIEW_ENABLED",
    "EXACT_THIRTEENTH_CENTAVOS_ENABLED", "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED"])
    assert.equal(env[flag], "false", "OIDC_IDENTITY_REFUSED: " + flag);
  for (const name of ["NEON_DATABASE_URL", "OPENAI_API_KEY", "RESEND_API_KEY", "SMTP_URL", "SMTP_PASSWORD",
    "XENDIT_SECRET_KEY", "PAYMONGO_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "CRON_SECRET", "WORKER_TOKEN"])
    assert.ok(!env[name], "OIDC_IDENTITY_REFUSED: no live credentials");
  return true;
}
