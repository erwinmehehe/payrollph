import assert from "node:assert/strict";
export const APP = "http://127.0.0.1:3000";
export const CANONICAL_APP = "https://payroll.example.test";
export const IDP_HOST = "oidc.payrollph.invalid";
// Assigned ONLY to lo on the disposable runner, with non-loopback egress
// explicitly rejected. A public-shaped address exercises the unchanged SSRF
// and pinned-IP HTTPS transport; it is never contacted over the internet.
export const IDP_IP = "93.184.216.2";
export const IDP_ORIGIN = "https://" + IDP_HOST + ":8443";
export const TLS_DIR = "/tmp/payrollph-oidc-full";
export const METHOD = "GET auth/sso/callback";
export function requireFullOidcEnv(env = process.env) {
  for (const [key, value] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", NODE_ENV: "production",
    OIDC_FULL_HTTP_PROOF: "isolated-pg16-real-https-idp-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: APP, APP_BASE_URL: CANONICAL_APP,
    NODE_EXTRA_CA_CERTS: TLS_DIR + "/ca.crt",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
    NEXT_CSP_ENABLED: "false", DEMO_MODE: "false",
  })) assert.equal(env[key], value, "OIDC_FULL_REFUSED: " + key);
  for (const key of ["NEON_DATABASE_URL", "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED",
    "OPENAI_API_KEY", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "SMTP_URL", "SMTP_PASSWORD", "CRON_SECRET", "WORKER_TOKEN"])
    assert.ok(!env[key], "OIDC_FULL_REFUSED: credentials or transport override " + key);
}
export function assertCallbackDenied(response, status) {
  assert.equal(response.status, status, "Callback refused for the wrong reason: " + response.text.slice(0, 100));
  assert.equal(typeof response.json?.error, "string");
  assert.ok(!response.headers.getSetCookie().some(value => value.startsWith("__Host-linaw_session=")),
    "A denied callback must not issue an authentication cookie");
}
