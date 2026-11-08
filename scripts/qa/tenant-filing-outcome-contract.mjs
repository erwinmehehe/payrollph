/**
 * Standalone government filing-outcome PATCH tenant-isolation proof.
 * Only a real disposable PostgreSQL 16 and localhost Next.js process are allowed.
 * Synthetic rejections do NOT certify agency acceptance or earn method credit.
 */
import assert from "node:assert/strict";

export const ENDPOINT = "/api/compliance/filing-validations/";
export const ORIGIN = "http://127.0.0.1:3000";
export const PROOF_MODE = "fictional-pg16-filing-outcome";

export function requireDisposableFilingEnv(env = process.env) {
  for (const [key, value] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_FILING_OUTCOME_MODE: PROOF_MODE,
    NODE_ENV: "production",
    DEMO_MODE: "false",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: ORIGIN,
    APP_BASE_URL: "https://payroll.example.test",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) {
    if (env[key] !== value) throw new Error("FILING_OUTCOME_REFUSED: non-disposable setting " + key);
  }
  if (env.MULTI_ENTITY_ENABLED === "true") {
    throw new Error("FILING_OUTCOME_REFUSED: multi-entity must be tested separately");
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY",
  ]) {
    if (env[key]) throw new Error("FILING_OUTCOME_REFUSED: external credential " + key);
  }
  return true;
}

function responseSurface(response) {
  return String(response.text ?? "") + "\n" +
    [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
}

export function assertFilingDenied(response, status, foreignMarkers = []) {
  assert.equal(response.status, status, "Unexpected filing denial: " + responseSurface(response).slice(0, 210));
  assert.ok(response.json && typeof response.json.error === "string" && response.json.error,
    "Denial must have a bounded JSON error");
  assert.equal(response.json.record, undefined, "A denied filing request must not return a record");
  assert.notEqual(response.json.ok, true);
  for (const marker of foreignMarkers) {
    assert.ok(typeof marker === "string" && marker.length >= 8, "Real foreign marker required");
    assert.ok(!responseSurface(response).includes(marker), "Foreign filing identity leaked");
  }
  return response.json;
}

export function assertOwnFilingRejection(response, actor, filingId, note, foreignMarkers = []) {
  assert.equal(response.status, 200, "Authenticated, eligible own filing must persist");
  assert.ok(response.json?.record && typeof response.json.record === "object");
  const row = response.json.record;
  assert.equal(row.id, filingId, "Must update the selected genuine own filing");
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(row.legalEntityId, actor.entity.id);
  assert.equal(row.status, "rejected");
  assert.equal(row.outcomeNote, note);
  assert.equal(row.submissionMethod, "manual_entry");
  assert.equal(row.recordedBy, actor.owner.name);
  assert.ok(row.recordedAt, "The server must record the decision time");
  for (const marker of foreignMarkers) {
    assert.ok(!responseSurface(response).includes(marker), "Own result contains another tenant's marker");
  }
  return row;
}

export function assertFilingStateUnchanged(before, after, label) {
  assert.deepEqual(after, before, "Denied/rolled-back filing mutated tenant state: " + label);
}
