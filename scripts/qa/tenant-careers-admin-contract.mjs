/**
 * Adversarial contract for isolated Careers administrative publishing.
 * Pure assertions only. No database imports, production flags or coverage credits.
 */
import assert from "node:assert/strict";

const REQUIRED = Object.freeze({
  GITHUB_ACTIONS: "true",
  CI: "true",
  NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  MULTI_ENTITY_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  RECRUITMENT_JOURNEY_UI_ENABLED: "true",
  APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
  PUBLIC_INTAKE_PROOF_ENABLED: "true",
  CAREERS_PRIVACY_NOTICE_VERSION: "fictional-2026",
  CAREERS_PRIVACY_NOTICE_URL: "https://careers.example.invalid/privacy",
});

export function requireDisposableCareersAdminEnv(env = process.env) {
  for (const [name, value] of Object.entries(REQUIRED)) {
    assert.equal(env[name], value, "CAREERS_ADMIN_REFUSED: " + name + " must be the reviewed disposable value");
  }
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "MAILGUN_API_KEY",
  ]) assert.ok(!env[name], "CAREERS_ADMIN_REFUSED: no provider secrets: " + name);
}

export function assertNoVictimLeak(response, victim, label) {
  assert.ok(typeof response?.text === "string", label + ": response text missing");
  for (const marker of [victim.marker, victim.jobTitle, victim.orgName, victim.ownerName]) {
    assert.ok(!response.text.includes(marker), label + ": leaked real victim marker");
  }
}

export function provePublicCareersGet(response, employer, published, otherEmployers) {
  assert.equal(response.status, 200, "public GET must read the actual employer's real listing");
  assert.match(response.headers?.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.json?.organization, employer.orgName);
  assert.ok(Array.isArray(response.json?.jobs));
  const jobs = response.json.jobs;
  assert.equal(jobs.length, published ? 1 : 0,
    "a published own requisition must be present exactly once; an empty positive is not proof");
  if (published) {
    const [row] = jobs;
    assert.equal(row.id, employer.jobId);
    assert.equal(row.title, employer.jobTitle);
    assert.equal(row.department, employer.department);
    assert.equal(row.description, employer.description);
    assert.equal(row.employmentType, "Full-time");
    assert.deepEqual(Object.keys(row).sort(),
      ["id", "title", "department", "description", "employmentType"].sort(),
      "salary/PII/restricted requisition fields must never appear");
  }
  for (const other of otherEmployers) {
    for (const marker of [other.marker, other.jobTitle, other.orgName]) {
      assert.ok(!response.text.includes(marker), "foreign company's actual marker leaked");
    }
  }
  assert.ok(!response.text.includes(employer.closedTitle),
    "closed-position requisition cannot appear in public listings");
}

const PROTECTED = Object.freeze([
  "organizations", "employees", "profiles", "positions", "requisitions",
  "applicants", "privacyEvidence", "payroll",
]);
export function assertUnchangedCareersTenant(before, after, label) {
  assert.deepEqual(after, before,
    label + ": no tenant, applicant, requisition, payroll or audit state may change");
}

export function provePublishedTransition(before, after, employer, published, response) {
  assert.equal(response.status, 200, "own publishing PATCH must return actual HTTP 200");
  assert.equal(response.json?.id, employer.jobId);
  assert.equal(response.json?.published, published);
  for (const key of PROTECTED) {
    assert.deepEqual(after[key], before[key],
      "publishing must not change protected table " + key);
  }
  assert.equal(after.publication.length, before.publication.length,
    "publication must not insert/delete requisitions");
  const old = before.publication.find(r => r.id === employer.jobId);
  const updated = after.publication.find(r => r.id === employer.jobId);
  assert.ok(old && updated, "real persisted requisition must exist in both states");
  assert.equal(old.organizationId, employer.orgId);
  assert.equal(updated.organizationId, employer.orgId);
  assert.equal(old.published, !published, "expected compare-and-swap before state");
  assert.equal(updated.published, published,
    "the real SQL-only careers_published field must change");
  assert.deepEqual(after.publication.filter(r => r.id !== employer.jobId),
    before.publication.filter(r => r.id !== employer.jobId),
    "other requisitions in the same tenant must be unchanged");
  assert.equal(after.audit.length, before.audit.length + 1,
    "exactly one immutable actor-bound audit event required");
  assert.deepEqual(after.audit.slice(0, -1), before.audit,
    "all prior audit business fields must be unchanged");
  const event = after.audit.at(-1);
  assert.equal(event.organizationId, employer.orgId);
  assert.equal(event.actor, employer.ownerName);
  assert.equal(event.action,
    published ? "Careers requisition published" : "Careers requisition unpublished");
  assert.equal(event.resource, String(employer.jobId));
  assert.deepEqual(event.metadata,
    { requestedByUserId: employer.ownerId, requisitionId: employer.jobId });
}
