/**
 * Pure, fail-closed contracts for the independent fictional PG16 photo-consent
 * tenant/employee isolation candidate. Neither consent nor its withdrawal is
 * an authoritative time punch, payroll change, or privacy-policy approval.
 */
import assert from "node:assert/strict";

export const CONSENT_METHOD = "POST web-bundy/consent";
export const CONSENT_VERSION = "selfie-attendance-v1";
export const CONSENT_FIXTURE_SCHEMA = "payrollph-tenant-photo-consent-v1";

export function requireDisposableConsentTarget(env = process.env, phase = "prove") {
  const expected = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", WFM_PUNCH_EVIDENCE_ENABLED: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(env[key], value,
      "PHOTO_CONSENT_REFUSED: disposable " + key + " must match");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.ok(!env[key], "PHOTO_CONSENT_REFUSED: external provider credential " + key);
  }
  if (phase === "bootstrap") {
    assert.ok(env.GITHUB_ENV && env.GITHUB_ENV.startsWith("/"),
      "PHOTO_CONSENT_REFUSED: only GitHub env-file bootstrap is allowed");
    assert.ok(!env.WFM_PUNCH_EVIDENCE_ORG_IDS,
      "PHOTO_CONSENT_REFUSED: IDs must be freshly seeded, not preconfigured");
  } else {
    assert.equal(phase, "prove");
    assert.ok(env.PHOTO_CONSENT_FIXTURE?.startsWith("/tmp/payrollph-photo-consent-"),
      "PHOTO_CONSENT_REFUSED: private CI fixture path required");
    assert.match(env.WFM_PUNCH_EVIDENCE_ORG_IDS ?? "", /^[1-9]\d*(?:,[1-9]\d*){2}$/,
      "PHOTO_CONSENT_REFUSED: exact three seeded employer IDs required");
  }
}

export function assertNonCacheableConsent(headers) {
  const directives = (headers?.get("cache-control") ?? "")
    .toLowerCase().split(",").map(part => part.trim()).filter(Boolean);
  assert.ok(directives.includes("no-store"),
    "photo consent receipt must have Cache-Control: no-store");
  const allowed = new Set(["private", "no-store", "no-cache", "max-age=0", "must-revalidate"]);
  assert.ok(directives.every(part => allowed.has(part)),
    "photo consent receipt must not allow public or shared caching");
}

export function assertOwnedConsentReceipt(reply, choice, status) {
  assert.equal(reply?.status, 200, "authenticated own employee consent must succeed");
  assert.match(reply.headers?.get("content-type") ?? "", /^application\/json(?:;|$)/i);
  assertNonCacheableConsent(reply.headers);
  assert.ok(reply.json && typeof reply.json === "object" && !Array.isArray(reply.json));
  assert.deepEqual(Object.keys(reply.json).sort(), ["ok", "choice", "status"].sort(),
    "receipt may not expose employee, private image, or employer information");
  assert.equal(reply.json.ok, true);
  assert.equal(reply.json.choice, choice);
  assert.equal(reply.json.status, status);
  assert.ok(!reply.text.includes('"sealedPhoto"'));
  return reply.json;
}

export function assertConsentRefused(reply, expectedStatus, forbidden = []) {
  assert.equal(reply?.status, expectedStatus, "foreign/invalid consent must be refused");
  assert.ok(typeof reply.text === "string" && reply.text.length <= 1200,
    "consent denial must be bounded");
  assert.ok(reply.json && typeof reply.json.error === "string" &&
    reply.json.error.length > 0, "denial must be a generic error, not an own receipt");
  for (const key of ["ok", "choice", "employeeId", "consent", "sealedPhoto", "photoEvidence"]) {
    assert.equal(reply.json[key], undefined, "denial cannot serialize " + key);
  }
  for (const marker of forbidden) {
    assert.ok(marker && !reply.text.includes(marker),
      "refusal leaked a real foreign employee, employer or photograph marker");
  }
}
