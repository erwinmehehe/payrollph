import assert from "node:assert/strict";

/**
 * Exact disposable GitHub Actions only. Call before importing any app/DB code.
 * Never attempt to probe live payroll, billing, production, staging, or Neon.
 */
export function requireDisposableWrk02Batch2(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WRK02_BATCH2_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) {
    assert.equal(env[key], expected,
      "WRK02_BATCH2_REFUSED: requires exact disposable " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY", "NEON_DATABASE_URL",
  ]) {
    assert.ok(!env[key], "WRK02_BATCH2_REFUSED: forbids provider/remote credential " + key);
  }
}

export const BATCH2_METHODS = Object.freeze([
  "src/app/api/workforce-planning/baselines/route.ts POST",
  "src/app/api/workforce-planning/position-executions/route.ts POST",
  "src/app/api/workforce-planning/position-executions/route.ts PATCH",
]);

export function assertDeniedPlanning(response, status, forbiddenMarkers = []) {
  assert.equal(response?.status, status,
    "Expected real tenant denial " + status + ", received " + response?.status +
    " " + String(response?.text).slice(0, 160));
  assert.ok(response.json && typeof response.json.error === "string",
    "Denied planning method must return a bounded error body");
  assert.ok(typeof response.text === "string" && response.text.length < 2200,
    "Denied planning response must not expose persisted employer planning rows");
  assert.equal(response.json.baseline, undefined);
  assert.equal(response.json.execution, undefined);
  for (const marker of forbiddenMarkers) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!response.text.includes(marker),
      "Denied HTTP body exposed fictional foreign tenant marker " + marker);
  }
}

export function assertStoredOwnedPlanning(response, stored, {
  method, organizationId, expectedStatus = 201, forbiddenMarkers = [],
}) {
  assert.equal(response.status, expectedStatus, method + " must genuinely succeed");
  assert.ok(stored && Number.isSafeInteger(stored.id) && stored.id > 0);
  assert.equal(stored.organizationId, organizationId,
    "Returned SQL ID must belong to actual actor's employer");
  const item = method === "baseline" ? response.json?.baseline : response.json?.execution;
  assert.ok(item && Number.isSafeInteger(item.id));
  assert.equal(item.id, stored.id, "HTTP proof must reference persisted SQL row");
  assert.equal(item.organizationId, organizationId);
  for (const marker of forbiddenMarkers) assert.ok(!response.text.includes(marker),
    "Authorized HTTP response included another employer's private marker");
}

export function assertPlanningUnchanged(before, after, context) {
  assert.deepEqual(after, before,
    context + " must leave every employer's real planning, payroll and audit SQL unchanged");
}
