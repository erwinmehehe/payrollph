import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const STUDIO_TRIAGE_ORIGIN = "http://127.0.0.1:3000";
export const STUDIO_TRIAGE_ROUTE = "/api/automation-studio";
export const STUDIO_TRIAGE_ROUTE_SHA = "3bfc6666644ca11b480cf2735e9563d46139ebf4";

export function gitBlobSha(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest("hex");
}

export function requireDisposableStudioTriageEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: STUDIO_TRIAGE_ORIGIN,
    TRUSTED_APP_ORIGINS: STUDIO_TRIAGE_ORIGIN,
    SECURITY_SMOKE_URL: STUDIO_TRIAGE_ORIGIN,
    REQUIRE_PRIVILEGED_MFA: "true",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required)) {
    assert.equal(env[key], value, "STUDIO_TRIAGE_REFUSED: unsafe " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  ]) assert.ok(!env[key], "STUDIO_TRIAGE_REFUSED: external provider credential " + key);
}

export function assertNoTenantMarkers(response, employers, context) {
  assert.equal(typeof response?.text, "string", context + ": response body is required");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  for (const employer of employers) {
    assert.ok(!decoded.includes(employer.marker),
      context + ": private tenant marker disclosed from " + employer.label);
  }
}

export function assertOwnedCaseAck(response, actor, otherEmployers) {
  assert.equal(response.status, 200, actor.label + ": real own-case acknowledgement required");
  assert.equal(response.json?.operationalCase?.id, actor.case.id,
    "Must update exactly the persisted owned case ID");
  assert.equal(response.json?.operationalCase?.organizationId, actor.org.id);
  assert.equal(response.json?.operationalCase?.status, "acknowledged");
  assert.equal(response.json?.operationalCase?.acknowledgedByUserId, actor.owner.id);
  assert.equal(response.json?.sourceMutation, false);
  assert.equal(response.json?.executionStatusUnchanged, true);
  assert.ok(response.json.operationalCase.title.includes(actor.marker),
    "Must show the real owned case, not an empty successful response");
  assertNoTenantMarkers(response, otherEmployers, "own-case acknowledge");
}

export function assertDeniedTriage(response, status, protectedEmployers, context) {
  assert.equal(response.status, status, context + ": exact denial status required");
  assert.ok(!response.json?.operationalCase,
    context + ": denied response must not contain an operational case");
  assertNoTenantMarkers(response, protectedEmployers, context);
}

export function assertUnchangedSnapshot(before, after, context) {
  assert.deepEqual(after, before, context + ": denied request mutated tenant SQL");
}

export function assertOwnAcknowledgementDelta(before, after, actor) {
  assert.equal(before.automationOperationalCases.length, 1,
    "The before snapshot must contain exactly one persisted case");
  assert.equal(after.automationOperationalCases.length, 1,
    "The action must neither add nor remove operational cases");
  const oldCase = before.automationOperationalCases[0];
  const newCase = after.automationOperationalCases[0];
  assert.equal(oldCase.id, actor.case.id);
  assert.equal(newCase.id, actor.case.id);
  assert.equal(oldCase.status, "open");
  assert.equal(newCase.status, "acknowledged");
  assert.equal(newCase.acknowledgedByUserId, actor.owner.id);
  assert.equal(newCase.acknowledgedByName, actor.owner.name);
  assert.ok(Number.isFinite(Date.parse(newCase.acknowledgedAt)));
  assert.ok(Number.isFinite(Date.parse(newCase.updatedAt)));
  const mutable = new Set([
    "status", "acknowledgedByUserId", "acknowledgedByName", "acknowledgedAt", "updatedAt",
  ]);
  for (const [field, value] of Object.entries(oldCase)) {
    if (mutable.has(field)) continue;
    assert.deepEqual(newCase[field], value, "Only case-acknowledgement fields may change: " + field);
  }
  assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
    "Successful own acknowledgement must write exactly one audit row");
  assert.deepEqual(after.auditEvents.slice(0, before.auditEvents.length), before.auditEvents,
    "Existing audit rows must be unchanged");
  const audit = after.auditEvents.at(-1);
  assert.equal(audit.organizationId, actor.org.id);
  assert.equal(audit.action, "Automation operations case acknowledge");
  assert.equal(audit.metadata?.caseId, actor.case.id);
  assert.equal(audit.metadata?.sourceMutation, false);
  assert.equal(audit.metadata?.underlyingExecutionStatusUnchanged, true);
  for (const [table, rows] of Object.entries(before)) {
    if (table === "automationOperationalCases" || table === "auditEvents") continue;
    assert.deepEqual(after[table], rows, "Own acknowledgement must not mutate " + table);
  }
}
