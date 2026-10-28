import assert from "node:assert/strict";

// Exact MNY-02 method only. This module is pure: no DB, auth, or HTTP imports.
export const METHOD = "POST treasury-controls";
export const ENDPOINT = "/api/treasury-controls";

export function requireDisposableTreasury(env = process.env) {
  let server, database;
  try {
    server = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("MNY02_TREASURY_REFUSED: explicit localhost URLs required");
  }
  const required = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TREASURY_MODE: "fictional-mny02-only",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    DEMO_MODE: "false",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  };
  for (const [name, expected] of Object.entries(required))
    assert.equal(env[name], expected, "MNY02_TREASURY_REFUSED: " + name);
  assert.equal(server.href, "http://127.0.0.1:3000/",
    "MNY02_TREASURY_REFUSED: localhost Next.js only");
  assert.equal(database.protocol, "postgresql:",
    "MNY02_TREASURY_REFUSED: PostgreSQL only");
  assert.equal(database.hostname, "127.0.0.1",
    "MNY02_TREASURY_REFUSED: localhost PostgreSQL only");
  assert.equal(database.port, "5432",
    "MNY02_TREASURY_REFUSED: isolated PostgreSQL port only");
  assert.equal(database.pathname, "/app_db",
    "MNY02_TREASURY_REFUSED: disposable app_db only");
  assert.equal(database.username, "postgres",
    "MNY02_TREASURY_REFUSED: disposable PostgreSQL role only");
  assert.equal(env.APP_BASE_URL, "https://payroll.example.test",
    "MNY02_TREASURY_REFUSED: non-routable metadata origin only");
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "NEON_DATABASE_URL",
  ]) assert.ok(!env[name], "MNY02_TREASURY_REFUSED: live secret " + name);
  return true;
}

export function assertNoTreasuryLeak(response, privateMarkers = []) {
  assert.ok(response && typeof response.text === "string" &&
    response.headers && typeof response.headers.entries === "function");
  const content = response.text + "\n" +
    [...response.headers.entries()].map(([key, value]) => key + ": " + value).join("\n");
  for (const marker of privateMarkers) {
    assert.ok(typeof marker === "string" && marker.length > 4);
    assert.ok(!content.includes(marker),
      "MNY-02: cross-employer private marker in HTTP body/headers");
  }
}

export function assertTreasuryDenied(response, status, privateMarkers = []) {
  assert.equal(response.status, status,
    "MNY-02: exact signed-in denied HTTP status required; got " + response.status);
  assert.ok(response.json && typeof response.json.error === "string",
    "MNY-02: error envelope required");
  for (const name of ["enabled", "enabledAt", "operatorUserIds", "policy", "assignment"])
    assert.ok(!Object.hasOwn(response.json, name),
      "MNY-02: denied response leaks private control field " + name);
  assertNoTreasuryLeak(response, privateMarkers);
}

const UNTOUCHED = [
  "organizations", "staff", "payProfiles", "payroll", "payoutChanges",
  "memberships", "members",
];
export function assertUnchangedTreasury(before, after, label = "denied request") {
  assert.deepEqual(after, before,
    "MNY-02 " + label + ": employer policy, operators, payroll and audit must remain immutable");
}

export function assertSavedTreasury(before, after, response, actor, {
  enabled, separation, operatorUserIds, foreignMarkers = [],
}) {
  assert.equal(response.status, 200,
    "MNY-02: an actual company-wide owner must save a policy, not return a blocker");
  assert.deepEqual(Object.keys(response.json ?? {}).sort(),
    ["enabled", "enabledAt", "operatorUserIds", "requireReleaseSubmitterSeparation"]);
  assert.equal(response.json.enabled, enabled);
  assert.equal(response.json.requireReleaseSubmitterSeparation, separation);
  assert.deepEqual(response.json.operatorUserIds, operatorUserIds);
  assertNoTreasuryLeak(response, foreignMarkers);
  for (const key of UNTOUCHED)
    assert.deepEqual(after[key], before[key],
      "MNY-02: changing a treasury policy may never alter " + key);
  assert.equal(after.policies.length, 1,
    "MNY-02: own successful HTTP call must persist exactly one treasury policy");
  const policy = after.policies[0];
  assert.equal(policy.organizationId, actor.org.id);
  assert.equal(policy.enabled, enabled);
  assert.equal(policy.requireReleaseSubmitterSeparation, separation);
  assert.equal(policy.createdByUserId, actor.owner.id);
  assert.equal(policy.updatedByUserId, actor.owner.id);
  if (enabled) {
    assert.ok(policy.enabledAt instanceof Date,
      "MNY-02: enabled policy must have a real DB timestamp");
    assert.equal(response.json.enabledAt, policy.enabledAt.toISOString());
  } else {
    assert.equal(policy.enabledAt, null);
    assert.equal(response.json.enabledAt, null);
  }
  const active = after.assignments.filter(row => row.active)
    .map(row => row.userId).sort((a, b) => a - b);
  assert.deepEqual(active, [...operatorUserIds].sort((a, b) => a - b),
    "MNY-02: exact own-employer operator assignments must be persisted");
  for (const row of after.assignments) {
    assert.equal(row.organizationId, actor.org.id);
    assert.equal(row.updatedByUserId, actor.owner.id);
  }
  assert.equal(after.audit.length, before.audit.length + 1,
    "MNY-02: each successful policy change must write one own-employer audit event");
  assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit,
    "MNY-02: prior business audit records cannot change");
  const event = after.audit[after.audit.length - 1];
  assert.equal(event.organizationId, actor.org.id);
  assert.equal(event.actor, actor.owner.name);
  assert.equal(event.action, enabled
    ? "Treasury separation policy enabled or updated"
    : "Treasury separation policy disabled");
  assert.equal(event.resource, "Payroll treasury controls");
  assert.equal(event.metadata.enabled, enabled);
  assert.equal(event.metadata.requireReleaseSubmitterSeparation, separation);
  assert.deepEqual(event.metadata.operatorUserIds, operatorUserIds);
  assert.equal(event.metadata.configuredByUserId, actor.owner.id);
  return policy;
}
