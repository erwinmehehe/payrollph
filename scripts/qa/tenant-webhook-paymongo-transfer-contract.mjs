import assert from "node:assert/strict";

/**
 * Refuse all non-disposable targets BEFORE any app/DB import.
 * PayMongo's signed callback is platform-scoped, not session-scoped. This
 * proof uses a fabricated platform secret and three isolated employers.
 */
export function requireDisposablePaymongoTransferWebhook(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WEBHOOK_PAYMONGO_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) {
    assert.equal(env[key], expected, "PAYMONGO_WEBHOOK_REFUSED: exact disposable " + key + " required");
  }
  assert.match(env.PAYMONGO_WEBHOOK_SECRET ?? "", /^[a-f0-9]{48,}$/,
    "PAYMONGO_WEBHOOK_REFUSED: generated synthetic signature secret required");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY", "NEON_DATABASE_URL",
  ]) {
    assert.ok(!env[key], "PAYMONGO_WEBHOOK_REFUSED: external provider/database credential forbidden: " + key);
  }
}

export const PAYMONGO_TRANSFER_WEBHOOK_METHODS = Object.freeze([
  "src/app/api/webhooks/paymongo/transfers/route.ts POST",
]);
