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

/**
 * A withdrawal updates exactly ONE persisted employee+version consent.
 * A first-time declining peer in the same employer is a separate valid row:
 * preserve that row byte-for-byte instead of assuming one consent per employer.
 * The comparison is over the complete ordered SQL consent snapshot (not a
 * mocked HTTP response). No other employee/version may be deleted or updated.
 */
export function assertScopedConsentWithdrawal(before, after, { organizationId, employeeId, actorUserId }) {
  for (const id of [organizationId, employeeId, actorUserId]) {
    assert.ok(Number.isSafeInteger(id) && id > 0,
      "withdrawal evidence requires real positive organization, employee and actor IDs");
  }
  assert.ok(Array.isArray(before?.consent) && Array.isArray(after?.consent),
    "withdrawal evidence requires real before/after SQL consent arrays");
  assert.equal(after.consent.length, before.consent.length,
    "withdrawal must update an existing row, not delete or insert another employee's consent");
  const own = rows => rows.filter(row => row.organizationId === organizationId &&
    row.employeeId === employeeId && row.consentVersion === CONSENT_VERSION);
  const previous = own(before.consent);
  const current = own(after.consent);
  assert.equal(previous.length, 1, "withdrawal requires exactly one existing own consent");
  assert.equal(current.length, 1, "withdrawal must retain exactly one owned consent");
  const prior = previous[0], changed = current[0];
  assert.ok(Number.isSafeInteger(prior.id) && prior.id > 0,
    "existing consent ID must originate from persisted PostgreSQL");
  assert.equal(prior.choice, "accepted", "withdrawal starts from accepted consent");
  assert.equal(changed.id, prior.id, "withdrawal must retain the own consent row ID");
  assert.equal(changed.choice, "declined", "withdrawal must persist the declined choice");
  assert.equal(changed.decidedByUserId, actorUserId,
    "withdrawal must record the authenticated employee's user ID");
  assert.ok(typeof changed.decidedAt === "string" &&
    Number.isFinite(Date.parse(changed.decidedAt)),
  "withdrawal must persist a real timestamp");
  assert.ok(Date.parse(changed.decidedAt) >= Date.parse(prior.decidedAt),
    "withdrawal timestamp cannot precede its original consent");
  // Only choice, actor and decision timestamp may change on the OWN row.
  assert.deepEqual({
    ...changed,
    choice: prior.choice,
    decidedByUserId: prior.decidedByUserId,
    decidedAt: prior.decidedAt,
  }, prior, "withdrawal cannot mutate any other consent source field");

  // The other same-employer worker's initial refusal and any other version
  // must be byte-identical, including choice, actor, date, ID and ordering.
  assert.deepEqual(
    after.consent.filter(row => row.id !== prior.id),
    before.consent.filter(row => row.id !== prior.id),
    "same-employer peer and unrelated consent records must remain byte-identical");
  return changed;
}

/** The withdrawal must add exactly one correct audit, preserving older entries. */
export function assertScopedWithdrawalAudit(before, after, { organizationId, employeeId, actorName }) {
  assert.ok(Array.isArray(before?.audits) && Array.isArray(after?.audits),
    "audit proof requires persisted PostgreSQL audit rows");
  assert.equal(after.audits.length, before.audits.length + 1,
    "withdrawal must append exactly one actor-scoped audit event");
  assert.deepEqual(after.audits.slice(0, -1), before.audits,
    "older audit business evidence, including peer's prior refusal, must not change");
  const audit = after.audits.at(-1);
  assert.ok(Number.isSafeInteger(audit.id) && audit.id > 0,
    "new audit must have a persisted database ID");
  assert.equal(audit.organizationId, organizationId);
  assert.equal(audit.actor, actorName);
  assert.equal(audit.action, "WFM selfie consent withdrawn");
  assert.equal(audit.resource, "WFM photo evidence");
  assert.deepEqual(audit.metadata, {
    employeeId, consentVersion: CONSENT_VERSION,
    choice: "declined", nonHeldPhotoBytesPurged: true,
  }, "withdrawal audit must describe exactly the authorized employee and version");
}
