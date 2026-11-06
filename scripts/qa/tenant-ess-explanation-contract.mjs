import assert from "node:assert/strict";
export const ROUTE = "src/app/api/self/payslips/[id]/explain/route.ts";
export const ROUTE_BLOB = "ebb5256925b599a34394c76a61b061fd34bea647";
/** Refuse connections or execution against anything but disposable CI PG16. */
export function requireIsolatedEssExplainProof(env = process.env) {
  const exact = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_ESS_EXPLAIN_PROOF: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(exact))
    assert.equal(env[key], value, "ESS_EXPLAIN_REFUSED: " + key);
  assert.ok(["true", "false"].includes(env.MULTI_ENTITY_ENABLED),
    "ESS_EXPLAIN_REFUSED: explicit multi-entity mode required");
  for (const key of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) assert.ok(!env[key], "ESS_EXPLAIN_REFUSED: credential " + key);
}
