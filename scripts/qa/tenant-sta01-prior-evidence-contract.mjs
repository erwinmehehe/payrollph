/**
 * STA-01 prior-employer tax evidence: disposable environment and proof assertions.
 * This helper is dependency-free so refusal happens BEFORE any DB/app import.
 * No tenant coverage credit, production release, real identifiers or money actions.
 */
import assert from "node:assert/strict";

export const PRIOR_PATH = "/api/year-end/prior-evidence";
export const PRIOR_YEAR = 2025;

const expected = Object.freeze({
  CI: "true",
  GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  YEAR_END_PRIOR_EVIDENCE_ENABLED: "true",
  MULTI_ENTITY_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  DEMO_MODE: "false",
});

export function requireDisposablePriorEvidenceEnv(env = process.env) {
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "STA01_PRIOR_REFUSED: unsafe or missing " + name);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY", "SMTP_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY", "NEON_DATABASE_URL"]) {
    assert.ok(!env[key], "STA01_PRIOR_REFUSED: external/provider secret " + key);
  }
  assert.match(env.PII_ENCRYPTION_KEY ?? "", /^[a-f0-9]{64}$/,
    "STA01_PRIOR_REFUSED: ephemeral 256-bit hex evidence key required");
  assert.ok(!/^([a-f0-9])\1{63}$/.test(env.PII_ENCRYPTION_KEY),
    "STA01_PRIOR_REFUSED: a repeated-character key is not ephemeral");
}

export function assertOwnPriorSave(response, employer) {
  assert.equal(response.status, 200,
    employer.label + ": own save must return HTTP 200; " + response.text.slice(0, 200));
  assert.equal(response.json?.record?.saved, true,
    employer.label + ": expected real successful tax-evidence save");
}

export function assertOwnPriorRead(response, employer, revision, approved) {
  assert.equal(response.status, 200,
    employer.label + ": own read must return HTTP 200; " + response.text.slice(0, 200));
  const result = response.json?.record;
  assert.ok(result?.evidence, employer.label + ": null/empty read is NOT a positive");
  assert.equal(result.evidence.sourceReference, employer.reference);
  assert.equal(result.evidence.sourceSha256, employer.sha);
  assert.equal(result.evidence.status, "none-confirmed");
  assert.equal(result.evidence.taxableIncome, "0.00");
  assert.equal(result.evidence.taxWithheld, "0.00");
  assert.equal(result.evidence.peraCredit, "0.00");
  assert.equal(result.revision, revision);
  assert.equal(result.approved, approved);
  assert.equal(result.makerUserId, employer.owner.id);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  return result;
}

export function assertPriorDenied(response, status, victim, label) {
  assert.equal(response.status, status, label + ": " + response.text.slice(0, 200));
  assert.ok(!response.text.includes(victim.marker), label + ": victim marker leaked");
  assert.ok(!response.text.includes(victim.reference), label + ": victim reference leaked");
  assert.ok(!response.text.includes(victim.sha), label + ": victim hash leaked");
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before,
    label + ": fictional employee, prior evidence, annualization, payroll and audit rows changed");
}
