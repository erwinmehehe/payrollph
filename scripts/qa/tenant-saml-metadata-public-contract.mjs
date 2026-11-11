/** Enabled public SP XML is a candidate, never a covered tenant method. */
import assert from "node:assert/strict";

export const ROUTE = "src/app/api/auth/saml/metadata/[providerId]/route.ts";
export const ROUTE_BLOB = "4f8d12b9867de0c18aea8e447208e8470773350b";
export const HIDDEN_PROVIDER_BODY = '{"error":"SAML provider not found."}';

export function requireIsolatedSamlProof(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_SAML_METADATA_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "SAML_PROOF_REFUSED: " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL",
    "STRIPE_SECRET_KEY", "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[name], "SAML_PROOF_REFUSED: credential " + name);
  }
}

export function assertMetadata(response, providerId, secretMarkers = []) {
  assert.equal(response.status, 200, "Enabled public SP metadata must return 200");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type") || "", /application\/samlmetadata\+xml/i);
  assert.match(response.text, /<EntityDescriptor\b/);
  assert.match(response.text, /<SPSSODescriptor\b/);
  assert.match(response.text, /WantAssertionsSigned="true"/);
  assert.match(response.text, /<AssertionConsumerService\b/);
  assert.ok(response.text.includes("entityID=\"https://payroll.example.test/api/auth/saml/metadata/" + providerId + "\""),
    "Entity ID must use fixed canonical HTTPS origin and the real provider ID");
  assert.ok(response.text.includes("Location=\"https://payroll.example.test/api/auth/saml/acs/" + providerId + "\""),
    "ACS URL must use fixed canonical HTTPS origin and the real provider ID");
  assert.ok(response.text.length > 250 && response.text.length < 3000);
  assert.doesNotMatch(response.text, /clientSecretEncrypted|samlX509Certificate|passwordHash|backupCodes|sk_live_/i);
  for (const marker of secretMarkers) {
    assert.ok(marker && !response.text.includes(marker), "Private employer or provider marker leaked");
  }
}

export function assertSameMetadata(a, b) {
  assert.equal(b.status, a.status);
  assert.equal(b.text, a.text, "Metadata responses must be caller- and selector-independent");
  for (const name of ["content-type", "cache-control", "x-content-type-options"]) {
    assert.equal(b.headers.get(name), a.headers.get(name), "Response header differs: " + name);
  }
}

export function assertMissingMetadata(response, markers = [], expectedStatus = 404) {
  assert.equal(response.status, expectedStatus,
    "Non-SAML, unknown or invalid providers must not return public metadata");
  assert.ok(expectedStatus === 400 || expectedStatus === 404);
  assert.doesNotMatch(response.text, /EntityDescriptor|SPSSODescriptor|AssertionConsumerService/);
  for (const marker of markers) {
    assert.ok(marker && !response.text.includes(marker),
      "Private employer/provider marker leaked in error response");
  }
}

export function assertHiddenMetadata(response, missing, markers = []) {
  assertMissingMetadata(response, markers, 404);
  assert.equal(response.text, HIDDEN_PROVIDER_BODY, "Hidden provider must use the generic error body");
  assert.equal(response.headers.get("cache-control"), "no-store", "Hidden provider must not be cached");
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/i);
  if (missing) assertSameMetadata(missing, response);
}
