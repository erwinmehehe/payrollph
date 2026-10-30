import assert from "node:assert/strict";

export const PII_APPROVAL_ROUTE = "/api/employee-identifier-requests";

/**
 * This approval-path exercise is deliberately more restrictive than the
 * application's ordinary runtime. It must never be pointed at a live tenant.
 * Validate BEFORE the runner imports any module that can initialize a DB pool.
 */
export function requireDisposablePiiApprovalEnv(env = process.env) {
  for (const [key, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    REQUIRE_PRIVILEGED_MFA: "true",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    NODE_ENV: "production",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) {
    assert.equal(env[key], expected, "PII_APPROVAL_REFUSED: " + key);
  }

  let database;
  try { database = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("PII_APPROVAL_REFUSED: explicit disposable PostgreSQL target required"); }
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.equal(database.username, "postgres");
  assert.equal(database.password, "postgres");
  assert.equal(database.search, "", "PII_APPROVAL_REFUSED: no database URL overrides");
  assert.equal(database.hash, "", "PII_APPROVAL_REFUSED: no database URL fragment");

  assert.match(env.PII_ENCRYPTION_KEY ?? "", /^[0-9a-f]{64}$/i,
    "PII_APPROVAL_REFUSED: disposable randomly provisioned PII key required");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "PII_ENCRYPTION_KEY_PREVIOUS",
  ]) {
    assert.ok(!env[key], "PII_APPROVAL_REFUSED: live credential or key rotation " + key);
  }
}

/** Failed responses cannot disclose victim-only identifiers or headers. */
export function assertNoPiiLeak(response, victimMarker, protectedValues, label) {
  assert.ok(typeof response.text === "string", label + ": real HTTP body required");
  const joined = response.text + JSON.stringify([...response.headers.entries()]);
  assert.ok(!joined.includes(victimMarker), label + ": victim marker leaked");
  for (const value of protectedValues) {
    assert.ok(!joined.includes(value), label + ": victim identifier leaked");
  }
  assert.ok(!/\b(?:public|s-maxage)\b/i.test(response.headers.get("cache-control") ?? ""),
    label + ": private HR responses must not be publicly cached");
}

/** Reusable invariant: approval, denial, or exception cannot mutate victim SQL. */
export function assertVictimPiiUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": victim identifiers, staff, audit or payroll changed");
}
