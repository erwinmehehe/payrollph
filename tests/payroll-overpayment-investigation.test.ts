import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessOverpaymentReview,
  parseLedgerPesoCents,
  parsePositivePesoCents,
  pesoCentsString,
  releasedPayrollEntryFingerprint,
} from "../src/lib/payroll-overpayment-investigation";

const sample = {
  id: 87,
  payrollRunId: 11,
  employeeId: 42,
  grossPay: "25000.00",
  deductions: "3600.00",
  netPay: "21400.00",
  status: "Ready",
  lineItems: [
    { code: "BASIC", amount: "22000.00" },
    { code: "OT", amount: "3000.00" },
  ],
  trace: { rules: "PH-2026.01", calculatedAt: "2026-10-01" },
};
const baseline = () => ({
  claimCents: 125050,
  netPayCents: 2140000,
  sourceReleased: true,
  sourceEntryCount: 1,
  workerStatus: "Active",
  openLoanCount: 0,
  separationStatuses: [] as string[],
  existingRetroCount: 0,
});

test("claimed overpayment amount must be positive exact centavos, never negative, exponent or extra precision", () => {
  for (const [raw, expected] of [
    ["0.01", 1],
    ["0.10", 10],
    ["3", 300],
    ["21400.00", 2140000],
    ["999999999.99", 99999999999],
    [14.25, 1425],
  ] as const) assert.equal(parsePositivePesoCents(raw), expected);
  for (const bad of [
    null, "", "0", "-0.01", "-200", "-1", "1.001",
    "1e4", "NaN", "Infinity", "01", "9999999999.00",
    {}, [], -1, Number.NaN, 0,
  ]) assert.equal(parsePositivePesoCents(bad), null, String(bad));
  assert.equal(pesoCentsString(1), "0.01");
  assert.equal(pesoCentsString(2140000), "21400.00");
  assert.throws(() => pesoCentsString(-1), /invalid currency/);
});

test("released net amount accepts exact ledger pesos including zero, but no negative or malformed register", () => {
  assert.equal(parseLedgerPesoCents("21400.00"), 2140000);
  assert.equal(parseLedgerPesoCents("0.00"), 0);
  assert.equal(parseLedgerPesoCents("1.2"), 120);
  assert.equal(parseLedgerPesoCents("-42.00"), null);
  assert.equal(parseLedgerPesoCents("21400.001"), null);
  assert.equal(parseLedgerPesoCents(Number.NaN), null);
});

test("released entry fingerprint seals gross, net, deductions, status, lines and calculation trace", () => {
  const first = releasedPayrollEntryFingerprint(sample);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, releasedPayrollEntryFingerprint({ ...sample }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({ ...sample, grossPay: "25001.00" }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({ ...sample, deductions: "3601.00" }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({ ...sample, netPay: "21401.00" }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({ ...sample, status: "Disputed" }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({
    ...sample, lineItems: [{ code: "BASIC", amount: "25000.00" }],
  }));
  assert.notEqual(first, releasedPayrollEntryFingerprint({
    ...sample, trace: { ...sample.trace, rules: "PH-2027.01" },
  }));
});

test("clean released source still never grants a deduction, recovery, liability or bank-payment conclusion", () => {
  const assessment = assessOverpaymentReview(baseline());
  assert.equal(assessment.status, "manual_review_only");
  assert.equal(assessment.deductionAuthorized, false);
  assert.equal(assessment.recoveryPosted, false);
  assert.equal(assessment.sourceConfirmsBankPayment, false);
  assert.ok(assessment.findings.some(row => row.code === "BANK_DISBURSEMENT_UNVERIFIED"));
  assert.ok(assessment.findings.some(row => row.code === "LAWFUL_DEDUCTION_NOT_ESTABLISHED"));
  assert.ok(assessment.requiredIndependentEvidence.some(value => value.includes("bank credit") || value.includes("bank")));
});

test("non-released, missing/duplicated, invalid net and oversized claimed source never become trusted", () => {
  const blocked = assessOverpaymentReview({
    ...baseline(),
    sourceReleased: false,
    sourceEntryCount: 2,
    claimCents: 3000000,
    netPayCents: 2500000,
  });
  assert.equal(blocked.status, "source_blocked");
  const codes = blocked.findings.map(x => x.code);
  for (const code of ["SOURCE_NOT_RELEASED", "SOURCE_ENTRY_AMBIGUOUS", "CLAIM_EXCEEDS_SOURCE_NET"]) {
    assert.ok(codes.includes(code), code);
  }
  assert.equal(assessOverpaymentReview({ ...baseline(), netPayCents: null }).status, "source_blocked");
  assert.equal(assessOverpaymentReview({ ...baseline(), sourceEntryCount: 0 }).status, "source_blocked");
});

test("separated workers, existing retro pay and outstanding loans require extra manual reconciliation", () => {
  const assessment = assessOverpaymentReview({
    ...baseline(),
    workerStatus: "Separated",
    separationStatuses: ["released", "approved"],
    openLoanCount: 2,
    existingRetroCount: 1,
  });
  for (const code of [
    "SEPARATION_REVIEW_REQUIRED",
    "FINAL_PAY_HISTORY_EXISTS",
    "LOAN_DEDUCTIONS_PRESENT",
    "EXISTING_RETRO_ADJUSTMENT",
  ]) assert.ok(assessment.findings.some(row => row.code === code), code);
  assert.equal(assessment.deductionAuthorized, false);
});

test("API is fail-closed behind company-wide payroll access, MFA and an OFF-by-default flag", () => {
  const route = readFileSync("src/app/api/payroll/overpayment-preflight/route.ts", "utf8");
  const panel = readFileSync("src/components/payroll-overpayment-workbench.tsx", "utf8");
  const parent = readFileSync("src/components/compensation-panel.tsx", "utf8");

  assert.ok(route.includes("PAYROLL_VIEW_ROLES"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes('process.env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED !== "true"'));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("Cache-Control"));
  assert.ok(route.includes("private, no-store"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("eq(payrollRuns.organizationId, organizationId)"));
  assert.ok(route.includes("entries.length === 1"));
  assert.ok(route.includes("eq(employeePayRetroAdjustments.sourcePayrollRunId, sourcePayrollRunId)"));

  // The workbench is only evidence and does not change balances or money.
  for (const forbidden of [
    /\bdb\.insert\(/,
    /\bdb\.update\(/,
    /\bdb\.delete\(/,
    /\btx\.insert\(/,
    /\btx\.update\(/,
    /\btx\.delete\(/,
  ]) assert.ok(!forbidden.test(route), String(forbidden));

  assert.ok(panel.includes("No deductions, salary changes") || panel.includes("deduct wages"));
  assert.ok(panel.includes("Copy unsaved evidence preview"));
  assert.ok(parent.includes("<PayrollOverpaymentWorkbench organizationId={organizationId}"));
});

test("no payroll math or external transfer is claimed by the helper", () => {
  const helper = readFileSync("src/lib/payroll-overpayment-investigation.ts", "utf8");
  assert.ok(helper.includes("deductionAuthorized: false"));
  assert.ok(helper.includes("recoveryPosted: false"));
  assert.ok(helper.includes("sourceConfirmsBankPayment: false"));
  assert.ok(!helper.includes("payroll-engine"));
});
