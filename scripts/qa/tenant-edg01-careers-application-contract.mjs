/**
 * EDG-01 Careers applicant intake: disposable HTTP/PG16 proof contracts.
 * Public application intake is deliberately anonymous, not an authenticated
 * own/foreign 403 boundary. Only matching employer + published requisition may
 * create a candidate; no tenant-method credit is implied.
 */
import assert from "node:assert/strict";

export const METHOD = "POST /api/careers";
export const NOTICE_VERSION = "2026.10-ci";

export function requireDisposableApplicationEnv(env = process.env) {
  const exact = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    MULTI_ENTITY_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    RECRUITMENT_JOURNEY_UI_ENABLED: "true",
    PUBLIC_INTAKE_PROOF_ENABLED: "true",
    APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
    CAREERS_PRIVACY_NOTICE_VERSION: NOTICE_VERSION,
    CAREERS_PRIVACY_NOTICE_URL: "https://payroll.example.test/privacy/recruitment",
    TRUSTED_PROXY_HOPS: "1",
  };
  for (const [key, value] of Object.entries(exact)) {
    assert.equal(env[key], value, "EDG01_APPLICATION_REFUSED: unsafe or missing " + key);
  }
  // Only the synthetic localhost request generator may choose the reserved
  // RFC 5737 proxy IPs. Never use a client-supplied XFF trust setting in prod.
  assert.ok(typeof env.PUBLIC_INTAKE_PROOF_SECRET === "string" &&
    env.PUBLIC_INTAKE_PROOF_SECRET.length >= 32,
    "EDG01_APPLICATION_REFUSED: synthetic proof signing secret required");
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "NEON_DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  ]) assert.ok(!env[name], "EDG01_APPLICATION_REFUSED: external credential " + name);
}

export function assertPublicReply(reply, status, forbidden = []) {
  assert.equal(reply?.status, status, "HTTP response status");
  assert.match(reply.headers?.get("cache-control") ?? "", /no-store/i,
    "public applicant response must not be stored by caches");
  if (status === 202) {
    assert.deepEqual(reply.json, { received: true },
      "success and duplicate must have identical bounded public receipts");
  } else {
    assert.ok(reply.json && typeof reply.json.error === "string",
      "denial requires a generic error receipt");
    for (const key of ["applicantId", "organizationId", "email", "jobs", "audit"]) {
      assert.equal(reply.json[key], undefined, "denial leaked " + key);
    }
  }
  for (const marker of forbidden) {
    assert.ok(!reply.text.includes(marker), "foreign private marker leaked");
  }
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": denied or duplicate request changed fictional SQL");
}

export function assertApplicationTransition(before, after, employer, candidate) {
  assert.deepEqual(after.jobs, before.jobs, "candidate POST cannot alter requisitions");
  assert.deepEqual(after.payroll, before.payroll, "candidate POST cannot alter draft payroll");
  assert.equal(after.applicants.length, before.applicants.length + 1,
    "one accepted application must insert exactly one own applicant");
  assert.deepEqual(after.applicants.slice(0, -1), before.applicants,
    "preexisting applicants must stay byte-identical");
  const applicant = after.applicants.at(-1);
  assert.equal(applicant.organizationId, employer.org.id);
  assert.equal(applicant.requisitionId, employer.job.id);
  assert.equal(applicant.fullName, candidate.fullName);
  assert.equal(applicant.email, candidate.email);
  assert.equal(applicant.phone, candidate.phone);
  assert.equal(applicant.notes, candidate.notes);
  assert.equal(applicant.stage, "applied");

  assert.equal(after.privacy.length, before.privacy.length + 1,
    "one new applicant must have one private consent evidence row");
  assert.deepEqual(after.privacy.slice(0, -1), before.privacy);
  const evidence = after.privacy.at(-1);
  assert.equal(evidence.organizationId, employer.org.id);
  assert.equal(evidence.applicantId, applicant.id);
  assert.equal(evidence.legalBasis, "consent");
  assert.equal(evidence.privacyNoticeVersion, NOTICE_VERSION);
  assert.match(evidence.sourceEvidenceReference, /^careers-web:/);
  assert.ok(evidence.consentCapturedAt instanceof Date);

  assert.equal(after.audits.length, before.audits.length + 1,
    "one new applicant must have one redacted, same-tenant audit");
  assert.deepEqual(after.audits.slice(0, -1), before.audits);
  const audit = after.audits.at(-1);
  assert.equal(audit.organizationId, employer.org.id);
  assert.equal(audit.action, "Published careers application received");
  assert.equal(audit.resource, "Applicant #" + applicant.id);
  assert.deepEqual(audit.metadata, {
    applicantId: applicant.id,
    requisitionId: employer.job.id,
    privacyNoticeVersion: NOTICE_VERSION,
    noCredentialsGranted: true,
  });
  assert.ok(!JSON.stringify(audit).includes(candidate.email),
    "audit must not disclose applicant contact details");
  assert.ok(!JSON.stringify(audit).includes(candidate.fullName),
    "audit must not disclose applicant identity");
}
