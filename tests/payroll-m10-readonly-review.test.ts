import assert from "node:assert/strict";
import test from "node:test";
import {
  buildM10ReadOnlyReview,
  type M10ReviewInput,
  type M10SssShares,
  type M10PagIbigShares,
} from "../src/lib/payroll-m10-readonly-review";
import { createM10FictionalCases, M10_FICTIONAL_SCENARIOS } from "./fixtures/m10-retro-agency-cases";
import {
  PAGIBIG_RULE_PACKS,
  SSS_RULE_PACKS,
  resolveEffectiveRulePack,
} from "../src/lib/ph-statutory-rule-packs";

const all = createM10FictionalCases();
const example = all[0];

function input(patch: Partial<M10ReviewInput>): M10ReviewInput {
  return { ...example, ...patch };
}

test("M-10: 12 scenarios x 2 fictional employers x 2 agencies remain unposted and unapproved", () => {
  assert.equal(M10_FICTIONAL_SCENARIOS.length, 12);
  assert.equal(all.length, 48);
  const rows = buildM10ReadOnlyReview(all);
  assert.equal(rows.length, 48);
  assert.equal(new Set(rows.map(row => row.caseKey)).size, 48);
  assert.equal(rows.filter(row => row.evidenceStatus === "POLICY_UNRESOLVED").length, 44);
  assert.equal(rows.filter(row => row.evidenceStatus === "NEEDS_EVIDENCE").length, 4);
  assert.equal(rows.filter(row => row.hypotheticalWorksheetDifference !== null).length, 44);
  for (const row of rows) {
    assert.equal(row.sssPolicyDecision, "NOT_OBTAINED");
    assert.equal(row.pagIbigPolicyDecision, "NOT_OBTAINED");
    assert.equal(row.canPostAgencyCorrection, false);
    assert.equal(row.agencyFilingAction, "NOT_AUTHORIZED");
    assert.equal(row.approvedAgencyLiabilityCentavos, null);
  }
});

test("M-10: same-month source evidence is not legal authorization to remit a retro difference", () => {
  const rows = buildM10ReadOnlyReview([all[0], all[1]]);
  for (const row of rows) {
    assert.equal(row.sourceDiffersFromPayrollMonth, false);
    assert.equal(row.evidenceStatus, "POLICY_UNRESOLVED");
    assert.equal(row.candidateContributionMonth, null);
    assert.equal(row.canPostAgencyCorrection, false);
  }
});

test("M-10: signed EE, ER, SSS MPF, EC and HDMF differences remain worksheet-only", () => {
  const sss = buildM10ReadOnlyReview([all[6]])[0];
  const hdmfInput = all.find(x => x.caseId === "fictional-101-Pag-IBIG-07");
  assert.ok(hdmfInput);
  const hdmf = buildM10ReadOnlyReview([hdmfInput])[0];
  assert.deepEqual(sss.hypotheticalWorksheetDifference, {
    agency: "SSS",
    employeeRegularCentavos: 500,
    employeeMpfCentavos: 0,
    employerRegularCentavos: 1000,
    employerMpfCentavos: 0,
    employerEcCentavos: 0,
    totalCentavos: 1500,
  });
  assert.deepEqual(hdmf.hypotheticalWorksheetDifference, {
    agency: "Pag-IBIG", employeeSavingsCentavos: 500, employerSavingsCentavos: 500,
    totalCentavos: 1000,
  });
  const reversed = buildM10ReadOnlyReview([all[7]])[0];
  assert.equal(reversed.hypotheticalWorksheetDifference?.totalCentavos, -1500);
  assert.equal(reversed.canPostAgencyCorrection, false);
  assert.equal(hdmf.canPostAgencyCorrection, false);
});

test("M-10: Dec 2024 / Jan 2025 and Jan / Feb 2024 never infer contribution month", () => {
  for (const code of ["10", "11"]) {
    const original = all.find(x => x.caseId === "fictional-202-SSS-" + code);
    assert.ok(original);
    const row = buildM10ReadOnlyReview([original])[0];
    assert.equal(row.sourceDiffersFromPayrollMonth, true);
    assert.equal(row.candidateContributionMonth, null);
    assert.equal(row.canPostAgencyCorrection, false);
    assert.equal(row.evidenceStatus, "POLICY_UNRESOLVED");
  }
  assert.throws(
    () => resolveEffectiveRulePack(SSS_RULE_PACKS, "2024-12-31", "SSS"),
    /No approved SSS rule pack/,
  );
  assert.throws(
    () => resolveEffectiveRulePack(PAGIBIG_RULE_PACKS, "2024-01-31", "Pag-IBIG"),
    /No approved Pag-IBIG rule pack/,
  );
  assert.equal(resolveEffectiveRulePack(SSS_RULE_PACKS, "2025-01-01", "SSS").params.employeeRate, 0.05);
  assert.equal(resolveEffectiveRulePack(PAGIBIG_RULE_PACKS, "2024-02-01", "Pag-IBIG").params.fundSalaryCeiling, 10000);
});

test("M-10: a caller's acknowledgement flag never grants approval", () => {
  const row = buildM10ReadOnlyReview([input({
    acknowledgeExceptions: true,
    candidateContributionMonth: "2026-10",
    remittanceState: "correction_accepted",
    originalReceiptReference: "SYNTH-ORIGINAL",
    correctionReceiptReference: "SYNTH-CORRECTION",
  })])[0];
  assert.equal(row.candidateContributionMonth, "2026-10");
  assert.equal(row.evidenceStatus, "POLICY_UNRESOLVED");
  assert.equal(row.canPostAgencyCorrection, false);
  assert.equal(row.agencyFilingAction, "NOT_AUTHORIZED");
});

test("M-10: tenant mismatch, employee mismatch, unreleased or missing source fails closed", () => {
  const invalid = [
    { sourceOrganizationId: 999 },
    { sourceEntryEmployeeId: 987654 },
    { sourceRunStatus: "Draft" },
    { sourceRunId: null },
    { sourceEntryId: null },
    { sourcePeriodStart: null, sourcePeriodEnd: null },
    { sourcePeriodStart: "2026-09-30", sourcePeriodEnd: "2026-10-01" },
    { sourcePeriodStart: "2026-02-30", sourcePeriodEnd: "2026-03-01" },
    { correctionPeriodStart: "2026-10-31", correctionPeriodEnd: "2026-10-01" },
  ];
  for (const mutation of invalid) {
    const row = buildM10ReadOnlyReview([input(mutation)])[0];
    assert.equal(row.evidenceStatus, "NEEDS_EVIDENCE");
    assert.equal(row.hypotheticalWorksheetDifference, null);
    assert.equal(row.canPostAgencyCorrection, false);
    assert.ok(row.evidenceIssues.length > 0);
  }
});

test("M-10: unknown/posted/submitted/corrected/rejected states require distinct actual evidence", () => {
  const invalid = [
    { remittanceState: "unknown" },
    { remittanceState: "submitted_unposted", submissionReference: null },
    { remittanceState: "paid_unposted", originalReceiptReference: null },
    { remittanceState: "posted", originalReceiptReference: null },
    { remittanceState: "correction_accepted", originalReceiptReference: "SYNTH-OR", correctionReceiptReference: null },
    { remittanceState: "rejected", rejectionReference: null },
    { remittanceState: "garbage" as M10ReviewInput["remittanceState"] },
  ];
  for (const mutation of invalid) {
    const row = buildM10ReadOnlyReview([input(mutation)])[0];
    assert.equal(row.evidenceStatus, "NEEDS_EVIDENCE");
    assert.equal(row.canPostAgencyCorrection, false);
  }
  assert.equal(buildM10ReadOnlyReview([input({
    remittanceState: "rejected", rejectionReference: "SYNTH-REJECTED",
  })])[0].evidenceStatus, "POLICY_UNRESOLVED");
});

test("M-10: duplicate keys block BOTH rows; employee, agency and organization are isolated", () => {
  const identical = buildM10ReadOnlyReview([example, { ...example, caseId: "replay" }]);
  assert.equal(identical.length, 2);
  assert.ok(identical.every(row => row.evidenceIssues.includes("DUPLICATE_CASE")));
  assert.ok(identical.every(row => row.hypotheticalWorksheetDifference === null));
  assert.ok(identical.every(row => row.canPostAgencyCorrection === false));
  // Same adjustment number for a different fictional employer or agency is not a duplicate.
  const others = buildM10ReadOnlyReview([
    example,
    { ...example, agency: "Pag-IBIG", originalWorksheetShares: null, revisedWorksheetShares: null },
    { ...example, organizationId: 202, sourceOrganizationId: 202 },
  ]);
  assert.equal(new Set(others.map(row => row.caseKey)).size, 3);
  assert.ok(others.every(row => !row.evidenceIssues.includes("DUPLICATE_CASE")));
});

test("M-10: centavos reject fractions, infinity, unsafe integers and overflow", () => {
  for (const amount of [1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const row = buildM10ReadOnlyReview([input({ wageDeltaCentavos: amount })])[0];
    assert.ok(row.evidenceIssues.includes("INVALID_WAGE_CENTAVOS"));
    assert.equal(row.wageDeltaCentavos, null);
  }
  const original: M10SssShares = {
    agency: "SSS", employeeRegularCentavos: 10000, employeeMpfCentavos: 0,
    employerRegularCentavos: 20000, employerMpfCentavos: 0, employerEcCentavos: 1000,
  };
  const broken: M10SssShares = { ...original, employeeRegularCentavos: 10500.25 };
  assert.ok(buildM10ReadOnlyReview([input({
    originalWorksheetShares: original, revisedWorksheetShares: broken,
  })])[0].evidenceIssues.includes("INVALID_WORKSHEET_CENTAVOS"));
  const overflowing: M10SssShares = {
    ...original, employeeRegularCentavos: Number.MAX_SAFE_INTEGER,
  };
  assert.ok(buildM10ReadOnlyReview([input({
    originalWorksheetShares: original, revisedWorksheetShares: overflowing,
  })])[0].evidenceIssues.includes("INVALID_WORKSHEET_CENTAVOS"));
});

test("M-10: missing/partial worksheets remain UNKNOWN, never a numeric zero", () => {
  assert.equal(buildM10ReadOnlyReview([input({
    originalWorksheetShares: null, revisedWorksheetShares: null,
  })])[0].hypotheticalWorksheetDifference, null);
  const partial = buildM10ReadOnlyReview([input({ revisedWorksheetShares: null })])[0];
  assert.ok(partial.evidenceIssues.includes("PARTIAL_WORKSHEET"));
  assert.equal(partial.hypotheticalWorksheetDifference, null);
});

test("M-10: zero wage with nonzero worksheet, invalid reviewer month and cross-agency shares are blocked", () => {
  const mismatch = buildM10ReadOnlyReview([input({ wageDeltaCentavos: 0 })])[0];
  assert.ok(mismatch.evidenceIssues.includes("ZERO_WAGE_WITH_NONZERO_WORKSHEET"));
  assert.equal(mismatch.hypotheticalWorksheetDifference, null);

  assert.ok(buildM10ReadOnlyReview([input({ candidateContributionMonth: "2026-13" })])[0]
    .evidenceIssues.includes("INVALID_CANDIDATE_MONTH"));

  const wrongAgency: M10PagIbigShares = {
    agency: "Pag-IBIG", employeeSavingsCentavos: 100, employerSavingsCentavos: 100,
  };
  assert.ok(buildM10ReadOnlyReview([input({
    revisedWorksheetShares: wrongAgency,
  })])[0].evidenceIssues.includes("INVALID_WORKSHEET_CENTAVOS"));
});
