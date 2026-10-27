import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYROLL_PERIOD, requireDisposableOverpaymentEnv,
  fictionalOverpaymentAmounts, ownOverpaymentBody,
  proveOwnedOverpaymentPreview, proveOverpaymentDenial,
  assertOverpaymentSourcesUnchanged,
} from "../scripts/qa/tenant-overpayment-preview-contract.mjs";

const first = {
  rank: 1, marker: "TTBL-ATTA-fixture",
  org: { id: 11 }, worker: {
    id: 21, employeeNo: "TTBL-ATTA-fixture",
    firstName: "Table", lastName: "TTBL-ATTA-fixture",
  },
  runId: 51, entryId: 61,
  periodLabel: "TTBL-ATTA-fixture fictional Released register",
  fingerprint: "a".repeat(64),
};
const second = {
  rank: 2, marker: "TTBL-ATTB-fixture",
  org: { id: 12 }, worker: {
    id: 22, employeeNo: "TTBL-ATTB-fixture",
    firstName: "Table", lastName: "TTBL-ATTB-fixture",
  },
  runId: 71, entryId: 81,
  periodLabel: "TTBL-ATTB-fixture fictional Released register",
  fingerprint: "b".repeat(64),
};

function response(subject = first) {
  const a = fictionalOverpaymentAmounts(subject.rank);
  const req = ownOverpaymentBody(subject);
  const json = {
    reviewOnly: true, saved: false,
    employee: {
      id: subject.worker.id, employeeNo: subject.worker.employeeNo,
      displayName: subject.worker.firstName + " " + subject.worker.lastName,
    },
    source: {
      runId: subject.runId, periodLabel: subject.periodLabel,
      periodStart: PAYROLL_PERIOD.start, periodEnd: PAYROLL_PERIOD.end,
      originalEntryId: subject.entryId,
      sourceFingerprint: subject.fingerprint,
      legalEntityChangedSinceSource: false,
    },
    variance: {
      reviewStatus: "possible_overpayment",
      sourceGross: a.grossPay, sourceDeductions: a.deductions,
      sourceNet: a.netPay,
      verifiedGross: a.verifiedGrossPay,
      verifiedNet: a.verifiedNetPay,
      grossDifference: a.grossDifference,
      netDifference: a.netDifference,
      verifiedImpliedDeductions: a.verifiedImpliedDeductions,
      hasSourceArithmeticWarning: false,
      automatedRecoveryAllowed: false,
    },
    evidenceReference: req.evidenceReference,
    reason: req.reason,
    requiredReviews: [
      "Independently verify actual bank-paid amount and original register against employer documents.",
      "Reconcile wage basis, withholding tax, SSS, PhilHealth and Pag-IBIG with a qualified payroll reviewer.",
      "Review Philippine employment-law requirements, written authorization and any dispute before considering a repayment or deduction.",
      "If worker is separated, reconcile final pay separately; this preview does not change separation, loan or final-pay state.",
    ],
    warning: "Differences are NOT established debt or recoverable wages. Nothing was stored, deducted, transferred, submitted, or posted to payroll.",
  };
  return {
    status: 200, json, text: JSON.stringify(json),
    headers: new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store, max-age=0",
    }),
  };
}
function altered(mutate, subject = first) {
  const reply = response(subject);
  mutate(reply);
  reply.text = JSON.stringify(reply.json);
  return reply;
}

test("only a disposable PG16/GitHub Actions job can run the financial tenant proof", () => {
  const safe = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
  };
  requireDisposableOverpaymentEnv(safe);
  for (const name of Object.keys(safe).filter(n => !n.endsWith("_KEY"))) {
    assert.throws(
      () => requireDisposableOverpaymentEnv({ ...safe, [name]: "invalid" }),
      /OVERPAYMENT_TENANT_REFUSED/, name);
    assert.throws(
      () => requireDisposableOverpaymentEnv({ ...safe, [name]: undefined }),
      /OVERPAYMENT_TENANT_REFUSED/, name);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(
      () => requireDisposableOverpaymentEnv({ ...safe, [key]: "live_secret" }),
      /OVERPAYMENT_TENANT_REFUSED/, key);
  }
});

test("three fictional source payrolls use distinct whole-centavo balanced evidence", () => {
  assert.deepEqual(fictionalOverpaymentAmounts(1), {
    grossPay: "20123.45", deductions: "3032.11", netPay: "17091.34",
    verifiedGrossPay: "19121.90", verifiedNetPay: "16290.23",
    grossDifference: "1001.55", netDifference: "801.11",
    verifiedImpliedDeductions: "2831.67",
  });
  const seen = new Set();
  for (const rank of [1, 2, 4]) {
    const a = fictionalOverpaymentAmounts(rank);
    assert.equal(Math.round(Number(a.grossPay) * 100),
      Math.round(Number(a.deductions) * 100) + Math.round(Number(a.netPay) * 100));
    assert.ok(Number(a.grossDifference) > 0 && Number(a.netDifference) > 0);
    assert.ok(!seen.has(a.grossPay));
    seen.add(a.grossPay);
  }
  assert.throws(() => fictionalOverpaymentAmounts(3));
  assert.throws(() => fictionalOverpaymentAmounts(-1));
});

test("requests bind real employer, employee, released run and a distinct evidence marker", () => {
  const own = ownOverpaymentBody(first);
  const other = ownOverpaymentBody(second);
  assert.deepEqual(Object.keys(own).sort(), [
    "organizationId", "employeeId", "payrollRunId",
    "verifiedGrossPay", "verifiedNetPay", "evidenceReference", "reason",
  ].sort());
  assert.equal(own.organizationId, 11);
  assert.equal(own.employeeId, 21);
  assert.equal(own.payrollRunId, 51);
  assert.equal(other.organizationId, 12);
  assert.equal(other.employeeId, 22);
  assert.equal(other.payrollRunId, 71);
  assert.ok(own.evidenceReference.includes(first.marker));
  assert.ok(!own.evidenceReference.includes(second.marker));
  assert.equal(ownOverpaymentBody(first, { payrollRunId: second.runId }).payrollRunId, 71);
});

test("actual positive source must match all own payroll identities and exact centavos", () => {
  proveOwnedOverpaymentPreview(response(first), first, [second.marker]);
  proveOwnedOverpaymentPreview(response(second), second, [first.marker]);
  assert.throws(() =>
    proveOwnedOverpaymentPreview(response(first), second));
  assert.throws(() =>
    proveOwnedOverpaymentPreview(response(second), first));
});

test("forged employee, payroll run, hash, centavos, and recovery authorization fail closed", () => {
  const mutations = [
    r => { r.status = 403; },
    r => { r.headers.delete("cache-control"); },
    r => { r.headers.set("content-type", "text/plain"); },
    r => { r.json.employee.id = second.worker.id; },
    r => { r.json.employee.employeeNo = second.marker; },
    r => { r.json.employee.displayName = "Foreign employee"; },
    r => { r.json.source.runId = second.runId; },
    r => { r.json.source.originalEntryId = second.entryId; },
    r => { r.json.source.periodLabel = second.periodLabel; },
    r => { r.json.source.sourceFingerprint = second.fingerprint; },
    r => { r.json.source.legalEntityChangedSinceSource = true; },
    r => { r.json.variance.sourceGross = "0.00"; },
    r => { r.json.variance.sourceDeductions = "0.00"; },
    r => { r.json.variance.sourceNet = "0.00"; },
    r => { r.json.variance.verifiedNet = "0.00"; },
    r => { r.json.variance.grossDifference = "0.01"; },
    r => { r.json.variance.reviewStatus = "no_variance"; },
    r => { r.json.variance.automatedRecoveryAllowed = true; },
    r => { r.json.reviewOnly = false; },
    r => { r.json.saved = true; },
    r => { r.json.requiredReviews = []; },
    r => { r.json.warning = "Recovery was approved."; },
    r => { r.json.evidenceReference = "forged-reference"; },
    r => { r.json.source.lineItems = [{ private: "salary" }]; },
    r => { r.json.employee.bankAccount = "PRIVATE"; },
    r => { r.json.extraTrace = { private: true }; },
    r => { r.json.reason = second.marker; },
  ];
  for (const mutate of mutations) {
    assert.throws(() => proveOwnedOverpaymentPreview(altered(mutate), first),
      "a forged own-success source must never be accepted");
  }
  const privateTrace = response(first);
  privateTrace.text += "TTBL-VICTIM-PRIVATE-TRACE";
  assert.throws(() =>
    proveOwnedOverpaymentPreview(privateTrace, first, ["TTBL-VICTIM-PRIVATE-TRACE"]));
});

test("denials must be exact HTTP codes, bounded, and contain no financial source or marker", () => {
  for (const [status, code] of [
    [400, "OVERPAYMENT_PREVIEW_INVALID_REQUEST"],
    [401, null], [403, null], [403, "MFA_REQUIRED"],
    [404, "OVERPAYMENT_SOURCE_NOT_FOUND"],
    [409, "OVERPAYMENT_SOURCE_ENTRY_COUNT"],
    [422, "INVALID_AMOUNT"], [422, "INCONSISTENT_VERIFIED_VALUES"],
  ]) {
    const json = { error: "Private source not available.", ...(code ? { code } : {}) };
    proveOverpaymentDenial({
      status, json, text: JSON.stringify(json),
    }, status, code, [first.marker, second.marker]);
  }
  for (const change of [
    r => { r.status = 200; },
    r => { r.json.employee = { id: first.worker.id }; },
    r => { r.json.source = { periodLabel: first.periodLabel }; },
    r => { r.json.error = first.marker; },
  ]) {
    const r = { status: 403, json: { error: "Private source not available." },
      text: '{"error":"Private source not available."}' };
    change(r);
    r.text = JSON.stringify(r.json);
    assert.throws(() => proveOverpaymentDenial(r, 403, null, [first.marker]));
  }
});

test("read-only source snapshots reject any changed payroll, worker, loan, payout or audit row", () => {
  const before = {
    staff: [{ id: 1 }], profiles: [{ id: 2 }],
    runs: [{ id: 3 }], entries: [{ id: 4 }],
    loans: [{ id: 5 }], leaves: [{ id: 6 }],
    payouts: [{ id: 7 }], audit: [{ id: 8 }],
  };
  assertOverpaymentSourcesUnchanged(before, structuredClone(before));
  for (const field of Object.keys(before)) {
    const mutated = structuredClone(before);
    mutated[field][0].changed = true;
    assert.throws(() => assertOverpaymentSourcesUnchanged(before, mutated), field);
  }
});

test("exact POST remains GAP; real source route enforces checker/MFA and has no money writes", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(manifest.allApiRouteFiles)
    .find(row => row.route === "payroll-overpayment-preview");
  assert.equal(record?.methods.find(m => m.name === "POST")?.status, "GAP",
    "no source-only or pending CI proof can grant a coverage credit");
  const route = readFileSync("src/app/api/payroll-overpayment-preview/route.ts", "utf8");
  const dbSource = readFileSync("src/lib/payroll-overpayment-preview-server.ts", "utf8");
  for (const clause of [
    "enforceSameOriginMutation(request)", "PAYROLL_TAX_APPROVER_ROLES",
    "!access?.companyWide", "requireSensitiveActionMfa(user)",
    "enforceSensitiveActionRateLimit(request",
    "loadReleasedOverpaymentEvidence(",
    "fingerprintReleasedPayrollEntry(", "reviewOnly: true", "saved: false",
  ]) assert.ok(route.includes(clause), "route gate missing: " + clause);
  for (const clause of [
    "eq(payrollRuns.organizationId, organizationId)",
    "eq(payrollRuns.status, \"Released\")",
    "eq(employees.organizationId, organizationId)",
    "eq(payrollEntries.employeeId, employeeId)",
    "eq(payrollEntries.payrollRunId, payrollRunId)",
    "entries.length !== 1",
  ]) assert.ok(dbSource.includes(clause), "source binding missing: " + clause);
  assert.doesNotMatch(route, /\b(?:db|tx)\.(?:insert|update|delete)\s*\(/,
    "preview route must never perform writes");
  const script = readFileSync("scripts/qa/tenant-overpayment-preview-http.mjs", "utf8");
  for (const clause of [
    "requireDisposableOverpaymentEnv()", "seedEmployer(",
    "victimSnapshot(", "standaloneRequest(", "ownOverpaymentBody(",
    "target.runId", "target.worker.id", "peer.id", "noMfa",
    "employeeSession.cookie", "duplicateRunId", "draftRunId",
    "assertOverpaymentSourcesUnchanged(",
  ]) assert.ok(script.includes(clause), "missing live PG16/HTTP evidence: " + clause);
});
