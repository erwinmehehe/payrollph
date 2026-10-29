import assert from "node:assert/strict";

export const HCM_DECISION_POST = "/api/hcm/employment-term-decisions";

/** Refuse all data operations unless this is the disposable GH Actions PG16 proof. */
export function requireDisposableHcmDecisionEnv(env = process.env) {
  assert.equal(env.CI, "true", "HCM_DECISION_REFUSED: CI required");
  assert.equal(env.GITHUB_ACTIONS, "true", "HCM_DECISION_REFUSED: GitHub Actions required");
  assert.equal(env.TENANT_SECOND_PASS_MODE, "isolated-ci-only",
    "HCM_DECISION_REFUSED: isolated tenant proof mode required");
  assert.equal(env.REQUIRE_PRIVILEGED_MFA, "true",
    "HCM_DECISION_REFUSED: real privileged-MFA requirement must remain enabled");
  assert.equal(env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000",
    "HCM_DECISION_REFUSED: localhost HTTP only");
  let database;
  try { database = new URL(env.DATABASE_URL ?? ""); } catch {
    throw new Error("HCM_DECISION_REFUSED: explicit disposable database URL required");
  }
  assert.equal(database.protocol, "postgresql:", "HCM_DECISION_REFUSED: PostgreSQL required");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname),
    "HCM_DECISION_REFUSED: database must be local");
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.equal(database.username, "postgres");
  assert.equal(database.password, "postgres");
  // PostgreSQL connection-string parameters (e.g. ?host=...) must never
  // override the verified loopback target or point the CI test at Neon.
  assert.equal(database.search, "", "HCM_DECISION_REFUSED: database URL query parameters forbidden");
  assert.equal(database.hash, "", "HCM_DECISION_REFUSED: database URL fragment forbidden");
  assert.notEqual(env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(env.XENDIT_PAYOUTS_ENABLED, "true");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "SMTP_PASSWORD"]) {
    assert.ok(!env[key], "HCM_DECISION_REFUSED: live provider credential " + key);
  }
}

export function assertVictimDecisionUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": denied HCM request touched victim SQL");
}

export function assertNoVictimDecisionLeak(response, marker, label) {
  assert.ok(typeof response.text === "string", label + ": real HTTP body required");
  assert.ok(!response.text.includes(marker), label + ": foreign HCM decision marker leaked");
}

/** Denied HTTP requests must return an error JSON, not victim records or HTML. */
export function assertDeniedHcmDecisionResponse(response, marker, label) {
  assertNoVictimDecisionLeak(response, marker, label);
  assert.ok(response.json && typeof response.json === "object" && !Array.isArray(response.json),
    label + ": denied request must return a JSON object");
  assert.ok(typeof response.json.error === "string" && response.json.error.length > 0,
    label + ": denied request must include an error");
  for (const key of ["decision", "employee", "term", "decisions", "employees", "terms"]) {
    assert.equal(Object.hasOwn(response.json, key), false,
      label + ": denial disclosed " + key + " data");
  }
}
