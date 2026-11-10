/**
 * SSO discovery is anonymous; this proves a domain/provider tenant binding,
 * not a signed-in tenant-private whole-method COVERED credit.
 */
import assert from "node:assert/strict";

export function requireDisposableSsoDiscovery(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_SSO_DISCOVERY_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "SSO_DISCOVERY_REFUSED: " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL",
    "STRIPE_SECRET_KEY", "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY",
  ]) assert.ok(!env[name], "SSO_DISCOVERY_REFUSED: real credential " + name);
  return true;
}

export function assertNoStore(headers) {
  const header = headers.get("cache-control") ?? "";
  const items = header.toLowerCase().split(",").map(s => s.trim());
  assert.ok(items.includes("no-store"), "anonymous discovery must not be cached");
  assert.ok(!items.includes("public"), "anonymous identity discovery must not be public-cacheable");
}

export function assertFound(result, provider, email, forbidden = []) {
  assert.equal(result.status, 200, "Own verified OIDC domain must resolve");
  assertNoStore(result.headers);
  assert.deepEqual(Object.keys(result.json ?? {}).sort(),
    ["available", "providerId", "providerName", "startUrl"].sort());
  assert.equal(result.json.available, true);
  assert.equal(result.json.providerId, provider.id);
  assert.equal(result.json.providerName, provider.name);
  assert.equal(result.json.startUrl,
    "/api/auth/sso/start?providerId=" + provider.id + "&loginHint=" + encodeURIComponent(email));
  for (const marker of forbidden) {
    assert.ok(!result.text.includes(marker), "foreign organization/provider marker appeared in own discovery");
  }
}

export function assertUnavailable(result, forbidden = []) {
  assert.equal(result.status, 200, "Unknown/mismatched domain must look unavailable");
  assertNoStore(result.headers);
  assert.deepEqual(result.json, { available: false });
  for (const marker of forbidden) {
    assert.ok(!result.text.includes(marker), "foreign tenant marker leaked from denied discovery");
  }
}
