/**
 * EDG-01 careers publication: proof-only contracts for disposable PG16 HTTP.
 * This code never approves tenant coverage, public recruiting or production use.
 */
import assert from "node:assert/strict";

export const METHOD = "PATCH /api/careers/admin";
export const PATH = "/api/careers/admin";

export function requireDisposableCareersEnv(env = process.env) {
  const exact = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", MULTI_ENTITY_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    RECRUITMENT_JOURNEY_UI_ENABLED: "true",
    PUBLIC_INTAKE_PROOF_ENABLED: "true",
    APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
    CAREERS_PRIVACY_NOTICE_VERSION: "2026.10-ci",
    CAREERS_PRIVACY_NOTICE_URL: "https://payroll.example.test/privacy/recruitment",
  };
  for (const [key, value] of Object.entries(exact)) {
    assert.equal(env[key], value, "EDG01_CAREERS_REFUSED: unsafe or missing " + key);
  }
  for (const key of ["RESEND_API_KEY", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "NEON_DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY"]) {
    assert.ok(!env[key], "EDG01_CAREERS_REFUSED: external provider credential " + key);
  }
}

export function assertDenied(reply, status, forbidden = []) {
  assert.equal(reply?.status, status,
    "career publication refusal status; " + String(reply?.text ?? "").slice(0, 160));
  assert.ok(typeof reply.text === "string" && reply.text.length < 1500,
    "careers error responses must be bounded");
  assert.ok(reply.json && typeof reply.json.error === "string",
    "denied publication must not return a successful publication receipt");
  for (const field of ["id", "published", "jobs", "applicants", "employeeId"]) {
    assert.equal(reply.json[field], undefined, "denial disclosed " + field);
  }
  for (const marker of forbidden) {
    assert.ok(marker && !reply.text.includes(marker), "foreign careers marker leaked");
  }
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": a denied request altered employer, requisition, audit or payroll state");
}

export function assertPublicationTransition(before, after, {
  organizationId, requisitionId, actorUserId, actorName, published,
}) {
  for (const id of [organizationId, requisitionId, actorUserId]) {
    assert.ok(Number.isSafeInteger(id) && id > 0, "actual persisted IDs required");
  }
  assert.equal(typeof published, "boolean");
  assert.ok(Array.isArray(before?.jobs) && Array.isArray(after?.jobs));
  const prior = before.jobs.filter(row => row.id === requisitionId);
  const next = after.jobs.filter(row => row.id === requisitionId);
  assert.equal(prior.length, 1, "real owned job is required");
  assert.equal(next.length, 1, "owned job must still exist");
  assert.equal(prior[0].organization_id, organizationId);
  assert.equal(prior[0].careers_published, !published,
    "positive must be a real publication state transition");
  assert.equal(next[0].careers_published, published);
  const originalAudits = before.audits, changedAudits = after.audits;
  assert.equal(changedAudits.length, originalAudits.length + 1,
    "successful publication requires exactly one persisted business audit event");
  assert.deepEqual(changedAudits.slice(0, -1), originalAudits,
    "existing audit business events cannot change");
  const audit = changedAudits.at(-1);
  assert.ok(Number.isSafeInteger(audit.id) && audit.id > 0);
  assert.equal(audit.organizationId, organizationId);
  assert.equal(audit.actor, actorName);
  assert.equal(audit.action, published
    ? "Careers requisition published" : "Careers requisition unpublished");
  assert.equal(audit.resource, String(requisitionId));
  assert.deepEqual(audit.metadata, { requestedByUserId: actorUserId, requisitionId });
  const expected = structuredClone(before);
  expected.jobs = before.jobs.map(row =>
    row.id === requisitionId ? { ...row, careers_published: published } : row);
  expected.audits = changedAudits;
  assert.deepEqual(after, expected,
    "only the owned careers_published column and one own audit may change");
}
