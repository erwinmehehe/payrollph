/**
 * Pure acceptance/negative contracts for an uncredited Compliance tenant GAP.
 * A synthetic REJECTED filing outcome is not an agency acknowledgement,
 * payment, remittance, payroll approval, or release.
 */
import assert from "node:assert/strict";

export const FILING_METHOD = "PATCH compliance/filing-validations/[id]";
export const FILING_PERIOD = Object.freeze({
  periodStart: "2026-09-01",
  periodEnd: "2026-09-15",
  payDate: "2026-09-15",
  applicableMonth: "2026-09",
});

export function requireDisposableFilingEnvironment(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(exact)) {
    assert.equal(env[name], value,
      "COMPLIANCE_FILING_REFUSED: disposable " + name + " required");
  }
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.ok(!env[name],
      "COMPLIANCE_FILING_REFUSED: provider credential not allowed: " + name);
  }
}

export function filingRejectionBody(ctx, orgId = ctx.orgId) {
  assert.ok(Number.isSafeInteger(orgId) && orgId > 0);
  assert.ok(typeof ctx.marker === "string" && ctx.marker.startsWith("TTBL-"));
  return {
    organizationId: orgId,
    outcome: "rejected",
    submissionMethod: "manual_entry",
    note: "Synthetic agency response for " + ctx.marker +
      ": fictional draft worksheet did not pass the required review.",
  };
}

const allExcept = (row, excluded) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key)));

export function proveOwnRejectedFiling(before, after, ctx, response) {
  assert.ok(before && after && ctx && response);
  assert.equal(response.status, 200,
    "the only positive case is an authenticated synthetic rejection");
  assert.ok(response.json && typeof response.json === "object");
  assert.deepEqual(Object.keys(response.json), ["record"]);
  for (const name of ["runs", "employees", "payProfiles"]) {
    assert.deepEqual(after[name], before[name],
      "filing outcome must not alter " + name);
  }
  assert.ok(Array.isArray(before.filings) && Array.isArray(after.filings));
  assert.equal(after.filings.length, before.filings.length,
    "PATCH must not create or remove filing records");
  const original = before.filings.find(row => row.id === ctx.seeded.id);
  const saved = after.filings.find(row => row.id === ctx.seeded.id);
  assert.ok(original && saved, "exact own persisted filing ID required");
  assert.deepEqual(after.filings.filter(row => row.id !== ctx.seeded.id),
    before.filings.filter(row => row.id !== ctx.seeded.id),
    "unrelated same-company filing records must remain unchanged");
  assert.equal(original.organizationId, ctx.orgId);
  assert.equal(original.legalEntityId, ctx.entityId);
  assert.equal(original.payrollRunId, ctx.seeded.runId);
  assert.equal(original.status, "generated");
  assert.equal(original.agency, "SSS");
  assert.equal(original.form, "R-3");
  assert.match(original.fileSha256, /^[0-9a-f]{64}$/);
  assert.ok(original.periodLabel.includes(ctx.marker));
  const changing = new Set([
    "status", "submissionMethod", "agencyReference", "submittedAt",
    "outcomeNote", "recordedBy", "recordedAt",
  ]);
  assert.deepEqual(allExcept(saved, changing), allExcept(original, changing),
    "immutable source hash, agency, legal employer, payroll run and source metadata must not change");
  assert.equal(saved.organizationId, ctx.orgId);
  assert.equal(saved.legalEntityId, ctx.entityId);
  assert.equal(saved.payrollRunId, ctx.seeded.runId);
  assert.equal(saved.id, ctx.seeded.id);
  assert.equal(saved.status, "rejected");
  assert.equal(saved.submissionMethod, "manual_entry");
  assert.equal(saved.agencyReference, null,
    "fictional rejected evidence cannot invent an official agency reference");
  assert.equal(saved.submittedAt, null);
  assert.equal(saved.outcomeNote, filingRejectionBody(ctx).note);
  assert.equal(saved.recordedBy, ctx.owner.name);
  assert.ok(typeof saved.recordedAt === "string" &&
    Number.isFinite(Date.parse(saved.recordedAt)),
    "one real decision timestamp must be persisted");
  assert.deepEqual(response.json.record, saved,
    "HTTP response must match the exact committed row, not an echoed request");
  assert.ok(Array.isArray(after.audit) && Array.isArray(before.audit));
  assert.equal(after.audit.length, before.audit.length + 1,
    "one successful own decision must produce exactly one matching audit event");
  assert.deepEqual(after.audit.slice(0, -1), before.audit,
    "prior audit evidence cannot be rewritten");
  const audit = after.audit.at(-1);
  assert.equal(audit.organizationId, ctx.orgId);
  assert.equal(audit.actor, ctx.owner.name);
  assert.equal(audit.action, "SSS R-3 filing rejected");
  assert.equal(audit.resource, saved.periodLabel);
  assert.deepEqual(audit.metadata, {
    recordId: saved.id,
    runId: saved.payrollRunId,
    fileSha256: saved.fileSha256,
    submissionMethod: "manual_entry",
    agencyReference: null,
    submittedAt: null,
  });
  assert.ok(!response.text.includes(ctx.victim.marker),
    "another employer's file or identifier must not appear in the own response");
}

export function proveFilingDenied(reply, expectedStatus, forbiddenMarkers) {
  assert.equal(reply?.status, expectedStatus,
    "foreign, stale or forged filing outcome must fail with exact HTTP status");
  assert.ok(typeof reply.text === "string" && reply.text.length < 2600,
    "denial body must not contain an entire filing record");
  assert.ok(reply.json && typeof reply.json.error === "string",
    "denial should expose only a bounded error");
  assert.equal(reply.json.record, undefined);
  for (const marker of forbiddenMarkers) {
    assert.ok(marker && !reply.text.includes(marker),
      "denial must not leak a real victim or peer source marker");
  }
}

export function proveFilingStateUntouched(before, after) {
  assert.deepEqual(after, before,
    "denied/stale filing outcomes cannot change employer, payroll, filing or audit state");
}
