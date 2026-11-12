/**
 * Fail-closed CI-only contract for OIDC browser-state HTTP proof.
 * Never allow production, hosted DB, credentials, provider calls or money.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const SOURCE_PINS = Object.freeze({
  "src/app/api/auth/sso/start/route.ts": "e955a785be36c1152fa5e9f7f0ac7348729e1924",
  "src/app/api/auth/sso/callback/route.ts": "a27d855a81751498cc907134e8e9dde7400c9f58",
  "src/lib/oidc-browser-state.ts": "cd772e6bed14633cc4fc7546140e16770ff54c3f",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/oidc-identity-binding.ts": "519337e0fe60544b9d5e6a6c17c6d00923e72b73",
  "tests/tenant-oidc-callback-identity-writes.test.mjs": "c676a042814a9fd2261362fbc780ed7ee77bbba7",
  "tests/tenant-oidc-identity-binding-postgres.test.ts": "d4601b051c3698a42c6bd90907eb4ff6ee6f2d0a",
  "scripts/qa/tenant-oidc-identity-binding-contract.mjs": "b161976203a61dfa128813397556efff8997871e",
  ".github/workflows/tenant-oidc-identity-binding-qa.yml": "48bccaa2df76f0fa2dc6f7114204ad5570dc9241",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(source) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  return createHash("sha1")
    .update(Buffer.from("blob " + buffer.length + "\0"))
    .update(buffer).digest("hex");
}

export function verifyOidcBrowserSourcePins() {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(path)), expected, "OIDC_BROWSER_REFUSED: changed source " + path);
  }
  return true;
}

export function requireDisposableOidcBrowserEnv(env = process.env) {
  const required = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_OIDC_BROWSER_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "https://payroll.example.test",
    SECURITY_SMOKE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
  };
  for (const [name, expected] of Object.entries(required)) {
    assert.equal(env[name], expected, "OIDC_BROWSER_REFUSED: unsafe " + name);
  }
  // OIDC start encrypts its PKCE verifier before persisting login state.
  // The PG16 runner must have a synthetic AES-256 key installed by CI;
  // otherwise HTTP 500 tests only missing setup, not browser-state isolation.
  assert.ok(
    typeof env.ENTERPRISE_IDENTITY_ENCRYPTION_KEY === "string" &&
      /^[0-9a-fA-F]{64}$/.test(env.ENTERPRISE_IDENTITY_ENCRYPTION_KEY),
    "OIDC_BROWSER_REFUSED: ephemeral 32-byte enterprise identity key is required",
  );
  for (const key of [
    "NEON_DATABASE_URL", "OPENAI_API_KEY", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "SMTP_URL",
    "SMTP_PASSWORD", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "WORKER_TOKEN", "CRON_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
  ]) {
    assert.ok(!env[key], "OIDC_BROWSER_REFUSED: provider or production credential " + key);
  }
  return true;
}

export function assertNoSessionOrAuditChanged(before, after, label) {
  assert.deepEqual(after.sessions, before.sessions, label + ": a callback unexpectedly changed sessions");
  assert.deepEqual(after.auditEvents, before.auditEvents, label + ": a callback unexpectedly changed audit");
  assert.deepEqual(after.externalIdentities, before.externalIdentities,
    label + ": a callback unexpectedly changed account linking");
}

export function assertBrowserDenial(response, label) {
  assert.equal(response.status, 403, label + ": cross-browser callback must be HTTP 403");
  assert.equal(response.json?.error,
    "OIDC login was not started in this browser. Restart sign-in.");
  assert.ok(response.headers.get("cache-control")?.includes("no-store"),
    label + ": denial must not be cached");
  assert.ok(!response.headers.get("set-cookie")?.includes("linaw_session="),
    label + ": denied browser must not receive an auth session");
}
