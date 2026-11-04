/**
 * API v1 public catalog: an intentionally tenant-independent metadata endpoint.
 * This is NOT tenant-scoped API method proof or authorization for a release.
 * Refuse non-fictional hosts and database targets before importing any app/DB.
 */
import assert from "node:assert/strict";

export function requireDisposableV1Catalog(env = process.env) {
  const expected = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_V1_PUBLIC_MODE: "isolated-ci-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "V1_CATALOG_REFUSED: " + name);
  }
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "SMTP_URL", "STRIPE_SECRET_KEY", "MAILGUN_API_KEY",
  ]) {
    assert.ok(!env[name], "V1_CATALOG_REFUSED: provider secret " + name);
  }
}

export function assertV1PublicCatalog(response, forbidden = []) {
  assert.equal(response.status, 200, "public API catalog must be readable without tenant auth");
  assert.equal(response.json?.name, "Linaw Public API");
  assert.equal(response.json?.version, "v1");
  assert.equal(response.json?.openApi, "/openapi/v1.json");
  assert.equal(response.json?.authentication?.scheme, "Bearer token");
  assert.ok(Array.isArray(response.json?.endpoints) && response.json.endpoints.length >= 6,
    "public metadata must contain the real API method catalog, not an empty placeholder");
  assert.ok(Array.isArray(response.json?.webhooks?.events) || typeof response.json?.webhooks?.events === "object",
    "webhook documentation must be present");
  assert.doesNotMatch(response.text, /sk_live_[a-z0-9]{16,}/i,
    "a real API key must never appear in public metadata");
  for (const marker of forbidden) {
    assert.ok(marker && !response.text.includes(marker),
      "an employer/user marker appeared in the public API catalog");
  }
}

export function assertV1CatalogEqual(expected, candidate) {
  assert.equal(candidate.status, expected.status);
  assert.deepEqual(candidate.json, expected.json,
    "anonymous, signed-in and forged-selector API catalogs must match exactly");
  assert.equal(candidate.text, expected.text,
    "public API catalog must not carry caller or tenant-specific bytes");
}
