/**
 * Safety gate and pure assertions for DEV POST API-key tenant isolation.
 * No imported database, app source, or side-effectful modules in this file.
 */
import assert from "node:assert/strict";

export const DEVELOPER_KEY_METHOD = "POST /api/developer";
export const PROOF_MODE = "fictional-pg16-http-only";

export function requireDeveloperKeyProofEnvironment(env = process.env) {
  const required = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_DEVELOPER_KEY_PROOF: PROOF_MODE,
    NODE_ENV: "production",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    APP_BASE_URL: "https://payroll.example.test",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  };
  for (const [key, wanted] of Object.entries(required)) {
    assert.equal(env[key], wanted, "DEV_KEY_PROOF_REFUSED: " + key);
  }
  // The only allowed database is an explicitly disposable GitHub Actions PG16.
  assert.equal(env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    "DEV_KEY_PROOF_REFUSED: no external database, port or connection option");
  assert.match(env.PII_ENCRYPTION_KEY ?? "", /^[0-9a-f]{64}$/i,
    "DEV_KEY_PROOF_REFUSED: ephemeral PII key required");
  for (const key of [
    "NEON_DATABASE_URL", "DATABASE_URL_UNPOOLED", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "BIOMETRIC_INGEST_SECRET", "OPENAI_API_KEY", "DOCUMENT_OBJECT_STORAGE_ENDPOINT",
  ]) {
    assert.ok(!env[key], "DEV_KEY_PROOF_REFUSED: external credential " + key);
  }
}

export function requireHttpStatus(response, expected, label) {
  // Do not print a response body: a valid mint response contains a one-time key.
  assert.equal(response.status, expected, label + " status");
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true,
    label + " must return real JSON");
  assert.ok(response.json && typeof response.json === "object",
    label + " JSON payload missing");
  return response;
}

export function assertOneTimeKeyCreated(response, name) {
  requireHttpStatus(response, 201, "owned developer API key creation");
  assert.ok(Number.isSafeInteger(response.json.id) && response.json.id > 0, "real generated SQL key ID required");
  assert.equal(response.json.name, name);
  assert.match(response.json.key, /^sk_live_[a-zA-Z0-9_-]{32,}$/, "real synthetic key minted");
  assert.ok(Array.isArray(response.json.scopes) && response.json.scopes.includes("employees:read"));
  assert.ok(!Object.hasOwn(response.json, "keyHash"), "server must never return stored hash");
}

export function assertForeignKeyDenial(foreign, missing, victimId) {
  requireHttpStatus(foreign, 404, "foreign key revocation");
  requireHttpStatus(missing, 404, "missing key revocation");
  assert.deepEqual(foreign.json, missing.json, "foreign key cannot reveal its existence");
  const text = foreign.text + JSON.stringify([...foreign.headers.entries()]);
  // Numeric IDs can appear coincidentally in HTTP Date/Content-Length headers.
  // Verify the entire denial instead: foreign and missing IDs must have the
  // same raw, generic JSON body with no echoed victim selector or key material.
  assert.ok(Number.isSafeInteger(victimId) && victimId > 0, "victim key ID must be real");
  assert.deepEqual(foreign.json, { error: "Key not found in this workspace." },
    "only a generic not-found response may be returned for a foreign key");
  assert.equal(foreign.text, missing.text, "raw foreign and absent key denials must match");
  assert.ok(!/sk_live_|keyHash|key_hash|keySecret/.test(text), "key material disclosed in denial");
}
