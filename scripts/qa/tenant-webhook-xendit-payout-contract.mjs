import assert from "node:assert/strict";

/**
 * Exact disposable GitHub Actions only. Call before importing any app/DB code.
 * The route pins ONE employer from the environment, so the pinned ids must be the
 * first organization and legal entity of a fresh database. Never probe live data.
 */
export function requireDisposableXenditPayoutWebhook(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WEBHOOK_XENDIT_PAYOUT_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: "1",
    XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID: "1",
  })) {
    assert.equal(env[key], expected, "XENDIT_PAYOUT_WEBHOOK_REFUSED: requires exact disposable " + key);
  }
  assert.ok((env.XENDIT_PAYOUT_CALLBACK_TOKEN ?? "").length >= 32, "XENDIT_PAYOUT_WEBHOOK_REFUSED: synthetic callback token required");
  assert.match(env.XENDIT_PAYOUT_BUSINESS_ID ?? "", /^biz-synthetic-[a-f0-9]{16,}$/, "XENDIT_PAYOUT_WEBHOOK_REFUSED: synthetic business id required");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY", "NEON_DATABASE_URL",
  ]) {
    assert.ok(!env[key], "XENDIT_PAYOUT_WEBHOOK_REFUSED: forbids provider/remote credential " + key);
  }
}

export const XENDIT_PAYOUT_WEBHOOK_METHODS = Object.freeze([
  "src/app/api/webhooks/xendit-payout/route.ts POST",
]);
