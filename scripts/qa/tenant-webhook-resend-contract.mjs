import assert from "node:assert/strict";

/**
 * Exact disposable GitHub Actions only. Call before importing any app/DB code.
 * The Resend delivery callback is authenticated by one platform-wide Svix signing secret and is
 * bound to a tenant only by a stored outbox row (outbox id AND the provider message id stored when
 * the send succeeded). The job carries a generated signing secret so the real route runs, but no
 * provider API key, SMTP URL or any other credential: nothing in it can send or call an email provider.
 */
export function requireDisposableResendWebhook(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WEBHOOK_RESEND_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
  })) {
    assert.equal(env[key], expected, "RESEND_WEBHOOK_REFUSED: exact disposable " + key + " required");
  }
  assert.notEqual(env.XENDIT_BILLING_ENABLED, "true", "RESEND_WEBHOOK_REFUSED: billing must stay off in this job");
  assert.match(env.RESEND_WEBHOOK_SECRET ?? "", /^whsec_[A-Za-z0-9+/]{43}=$/,
    "RESEND_WEBHOOK_REFUSED: generated synthetic whsec_ signing secret required");
  for (const key of [
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY", "OPENAI_API_KEY", "NEON_DATABASE_URL",
  ]) {
    assert.ok(!env[key], "RESEND_WEBHOOK_REFUSED: external provider/database credential forbidden: " + key);
  }
}

export const RESEND_WEBHOOK_METHODS = Object.freeze([
  "src/app/api/webhooks/resend/route.ts POST",
]);
