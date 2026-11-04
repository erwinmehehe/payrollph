import assert from "node:assert/strict";

export const MWE_DECISION_METHOD = "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts PATCH";
export const MWE_DECISION_SOURCE_SHA = "1861013e1006fbe8fa5f75ceb26767e9da807350";

export function requireDisposableMweDecision(env = process.env) {
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_MWE_DECISION_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  })) {
    assert.equal(env[name], value, "MWE_PATCH_REFUSED: disposable " + name + " required");
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[name], "MWE_PATCH_REFUSED: real provider/database secret " + name);
  }
  return true;
}
