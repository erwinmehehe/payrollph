import assert from "node:assert/strict";

/**
 * Exact disposable GitHub Actions only. Call before importing any app/DB code.
 * The Xendit subscription callback is authenticated by a platform-wide callback token
 * and merchant id, then bound to a tenant only by a stored checkout reference + plan id.
 * Billing is enabled here so the real route runs, but with NO provider secret key:
 * nothing in this job can call Xendit.
 */
export function requireDisposableXenditSubscriptionsWebhook(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WEBHOOK_XENDIT_SUBSCRIPTIONS_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "true",
  })) {
    assert.equal(env[key], expected, "XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED: exact disposable " + key + " required");
  }
  assert.match(env.XENDIT_CALLBACK_TOKEN ?? "", /^[a-f0-9]{48,}$/,
    "XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED: generated synthetic callback token required");
  assert.match(env.XENDIT_BUSINESS_ID ?? "", /^biz-synthetic-[a-f0-9]{16,}$/,
    "XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED: synthetic business id required");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY", "NEON_DATABASE_URL",
  ]) {
    assert.ok(!env[key], "XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED: external provider/database credential forbidden: " + key);
  }
}

export const XENDIT_SUBSCRIPTIONS_WEBHOOK_METHODS = Object.freeze([
  "src/app/api/webhooks/xendit/subscriptions/route.ts POST",
]);
