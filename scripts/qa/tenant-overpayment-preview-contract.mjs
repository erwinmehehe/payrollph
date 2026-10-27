/**
 * Pure, independently adversarial source contracts for a READ-ONLY
 * POST payroll-overpayment-preview tenant-isolation candidate.
 *
 * This is NOT an overpayment determination, debt, recovery, wage deduction,
 * or an approved payroll-release workflow. Only fictional PG16/localhost.
 */
import assert from "node:assert/strict";

export const PAYROLL_PERIOD = Object.freeze({
  start: "2026-09-01", end: "2026-09-15", pay: "2026-09-15",
});

export function requireDisposableOverpaymentEnv(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "true",
  };
  for (const [key, expected] of Object.entries(exact)) {
    assert.equal(env[key], expected,
      "OVERPAYMENT_TENANT_REFUSED: disposable " + key + " must match");
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
  ]) assert.ok(!env[key], "OVERPAYMENT_TENANT_REFUSED: no external provider credential: " + key);
}

const asMoney = (cents) => {
  assert.ok(Number.isSafeInteger(cents));
  const sign = cents < 0 ? "-" : "";
  const n = Math.abs(cents);
  return sign + String(Math.floor(n / 100)) + "." + String(n % 100).padStart(2, "0");
};

export function fictionalOverpaymentAmounts(rank) {
  assert.ok([1, 2, 4].includes(rank),
    "a real attacker/victim fixture rank is required");
  const gross = 2_000_000 + rank * 12_345;
  const deductions = 300_000 + rank * 3_211;
  const net = gross - deductions;
  const verifiedGross = gross - (100_000 + rank * 155);
  const verifiedNet = net - (80_000 + rank * 111);
  return {
    grossPay: asMoney(gross),
    deductions: asMoney(deductions),
    netPay: asMoney(net),
    verifiedGrossPay: asMoney(verifiedGross),
    verifiedNetPay: asMoney(verifiedNet),
    grossDifference: asMoney(gross - verifiedGross),
    netDifference: asMoney(net - verifiedNet),
    verifiedImpliedDeductions: asMoney(verifiedGross - verifiedNet),
  };
}

export function ownOverpaymentBody(subject, overrides = {}) {
  const a = fictionalOverpaymentAmounts(subject.rank);
  const body = {
    organizationId: subject.org.id,
    employeeId: subject.worker.id,
    payrollRunId: subject.runId,
    verifiedGrossPay: a.verifiedGrossPay,
    verifiedNetPay: a.verifiedNetPay,
    evidenceReference: subject.marker + "-disposable-evidence-20261027",
    reason: "Fictional, independently checked payroll source variance for " + subject.marker,
  };
  return { ...body, ...overrides };
}

export function proveOwnedOverpaymentPreview(reply, subject, forbiddenMarkers = []) {
  assert.equal(reply?.status, 200, "own authenticated preview must succeed");
  assert.match(reply.headers?.get("content-type") ?? "",
    /^application\/json(?:;|$)/i);
  assert.match(reply.headers?.get("cache-control") ?? "",
    /\bprivate\b.*\bno-store\b/);
  const body = reply.json;
  assert.ok(body && typeof body === "object" && !Array.isArray(body));
  assert.deepEqual(Object.keys(body).sort(), [
    "reviewOnly", "saved", "employee", "source", "variance",
    "evidenceReference", "reason", "requiredReviews", "warning",
  ].sort(), "preview may not expose private source lines or other fields");
  assert.equal(body.reviewOnly, true);
  assert.equal(body.saved, false);
  assert.deepEqual(body.employee, {
    id: subject.worker.id,
    employeeNo: subject.worker.employeeNo,
    displayName: subject.worker.firstName + " " + subject.worker.lastName,
  }, "actual employee ID/number/name must be bound to the own employer");
  assert.ok(body.source && typeof body.source === "object");
  assert.deepEqual(Object.keys(body.source).sort(), [
    "runId", "periodLabel", "periodStart", "periodEnd",
    "originalEntryId", "sourceFingerprint", "legalEntityChangedSinceSource",
  ].sort());
  assert.equal(body.source.runId, subject.runId);
  assert.equal(body.source.originalEntryId, subject.entryId);
  assert.equal(body.source.periodLabel, subject.periodLabel);
  assert.equal(body.source.periodStart, PAYROLL_PERIOD.start);
  assert.equal(body.source.periodEnd, PAYROLL_PERIOD.end);
  assert.match(body.source.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(body.source.sourceFingerprint, subject.fingerprint,
    "hash must match the exact persisted original register entry");
  assert.equal(body.source.legalEntityChangedSinceSource, false);
  const a = fictionalOverpaymentAmounts(subject.rank);
  assert.deepEqual(body.variance, {
    reviewStatus: "possible_overpayment",
    sourceGross: a.grossPay,
    sourceDeductions: a.deductions,
    sourceNet: a.netPay,
    verifiedGross: a.verifiedGrossPay,
    verifiedNet: a.verifiedNetPay,
    grossDifference: a.grossDifference,
    netDifference: a.netDifference,
    verifiedImpliedDeductions: a.verifiedImpliedDeductions,
    hasSourceArithmeticWarning: false,
    automatedRecoveryAllowed: false,
  }, "variance amounts must match the correct employer and exact cents");
  const original = ownOverpaymentBody(subject);
  assert.equal(body.evidenceReference, original.evidenceReference);
  assert.equal(body.reason, original.reason);
  assert.ok(Array.isArray(body.requiredReviews) && body.requiredReviews.length === 4);
  for (const review of body.requiredReviews) {
    assert.equal(typeof review, "string");
    assert.ok(review.length >= 25);
  }
  assert.ok(typeof body.warning === "string" &&
    body.warning.includes("Nothing was stored, deducted, transferred"),
    "the preview cannot authorize recovery or money movement");
  for (const marker of forbiddenMarkers) {
    assert.ok(marker && !reply.text.includes(marker),
      "other-employer/peer financial markers must not leak");
  }
  assert.ok(!reply.text.includes('"lineItems"') && !reply.text.includes('"trace"'),
    "full register evidence must not be serialized into the preview");
  return body;
}

export function proveOverpaymentDenial(reply, status, code, forbiddenMarkers = []) {
  assert.equal(reply?.status, status, "unauthorized source request denied");
  assert.ok(typeof reply.text === "string" && reply.text.length < 2600,
    "denial must be bounded and uninformative");
  assert.ok(reply.json && typeof reply.json.error === "string");
  if (code) assert.equal(reply.json.code, code);
  assert.equal(reply.json.employee, undefined);
  assert.equal(reply.json.source, undefined);
  assert.equal(reply.json.variance, undefined);
  for (const marker of forbiddenMarkers) {
    assert.ok(marker && !reply.text.includes(marker),
      "denial must not expose a real victim/peer payroll marker");
  }
}

export function assertOverpaymentSourcesUnchanged(before, after) {
  assert.deepEqual(after, before,
    "preview must not write source payroll, employee, pay, loans, leave, payout or audit rows");
}
