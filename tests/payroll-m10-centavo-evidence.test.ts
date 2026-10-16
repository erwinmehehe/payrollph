import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileM10IndependentCentavos,
  type M10IndependentExpectation,
} from "../src/lib/payroll-m10-centavo-evidence";
import { createM10FictionalCases } from "./fixtures/m10-retro-agency-cases";
import { createIndependentM10FictionalExpected } from "./fixtures/m10-independent-centavo-golden";

const inputs = createM10FictionalCases();
const expected = createIndependentM10FictionalExpected();

test("M-10 independently authored centavo ledger matches 44 rows; four missing source cases stay blocked", () => {
  assert.equal(inputs.length, 48);
  assert.equal(expected.length, 44);
  const result = reconcileM10IndependentCentavos(inputs, expected);
  assert.equal(result.scope, "SYNTHETIC_OR_READ_ONLY_INSPECTION");
  assert.equal(result.statutoryDecision, "NOT_OBTAINED");
  assert.equal(result.officialAgencyPosting, "NOT_TESTED");
  assert.equal(result.agencyCorrectionAuthorized, false);
  assert.equal(result.cases.length, 48);
  assert.equal(result.counts.MATH_MATCH_ONLY, 44);
  assert.equal(result.counts.SOURCE_EVIDENCE_INVALID, 4);
  assert.equal(result.counts.CENTAVO_MISMATCH, 0);
  assert.deepEqual(result.unexpectedExpectationIds, []);
  assert.match(result.reviewFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(result.cases.map(row => row.caseId)).size, 48);
  for (const row of result.cases) {
    assert.equal(row.agencyCorrectionAuthorized, false);
    assert.equal(row.agencyAccepted, false);
    assert.equal(row.payrollReleaseAuthorized, false);
    assert.equal(row.candidateContributionMonth, null);
  }
});

test("M-10 original and hypothetical revised SSS/HDMF shares are compared in integer centavos", () => {
  const result = reconcileM10IndependentCentavos(inputs, expected);
  const sssPositive = result.cases.find(row => row.caseId === "fictional-101-SSS-07");
  const sssNegative = result.cases.find(row => row.caseId === "fictional-101-SSS-08");
  const hdmfPositive = result.cases.find(row => row.caseId === "fictional-202-Pag-IBIG-07");
  assert.ok(sssPositive && sssNegative && hdmfPositive);
  assert.equal(sssPositive.hypotheticalDifference?.totalCentavos, 1500);
  assert.equal(sssNegative.hypotheticalDifference?.totalCentavos, -1500);
  assert.equal(hdmfPositive.hypotheticalDifference?.totalCentavos, 1000);
  assert.equal(sssPositive.reviewStatus, "MATH_MATCH_ONLY");
  assert.equal(sssNegative.reviewStatus, "MATH_MATCH_ONLY");
  assert.equal(hdmfPositive.reviewStatus, "MATH_MATCH_ONLY");
  assert.equal(sssNegative.remittanceState, "posted");
  assert.equal(sssNegative.agencyCorrectionAuthorized, false);
});

test("M-10 a missing independent expectation is unknown, not zero nor a valid approval", () => {
  const caseOne = inputs[0];
  const result = reconcileM10IndependentCentavos([caseOne], []);
  assert.equal(result.cases[0].reviewStatus, "INDEPENDENT_EXPECTATION_MISSING");
  assert.equal(result.cases[0].independentExpectedDifference, null);
  assert.equal(result.cases[0].agencyCorrectionAuthorized, false);
});

test("M-10 duplicate input case IDs cannot represent independent money rows", () => {
  const input = inputs[0];
  const result = reconcileM10IndependentCentavos(
    [input, { ...input, agency: "Pag-IBIG", originalWorksheetShares: null, revisedWorksheetShares: null }],
    expected,
  );
  assert.equal(result.cases.length, 2);
  assert.equal(result.counts.DUPLICATE_CASE_ID, 2);
  assert.ok(result.cases.every(row => !row.agencyCorrectionAuthorized));
});

test("M-10 duplicated expectation or spoofed identity cannot validate an employee's cents", () => {
  const first = inputs[0];
  const golden = expected[0];
  const duplicated = reconcileM10IndependentCentavos([first], [golden, golden]);
  assert.equal(duplicated.cases[0].reviewStatus, "INDEPENDENT_EXPECTATION_DUPLICATE");

  const mismatched = reconcileM10IndependentCentavos(
    [{ ...first, employeeId: 123456, sourceEntryEmployeeId: 123456 }],
    [golden],
  );
  assert.equal(mismatched.cases[0].reviewStatus, "INDEPENDENT_EXPECTATION_SCOPE_MISMATCH");
  assert.equal(mismatched.cases[0].agencyCorrectionAuthorized, false);
});

test("M-10 one centavo mismatch rejects math reconciliation even when expected total is internally consistent", () => {
  const first = inputs[0];
  const golden = expected[0];
  assert.equal(golden.expectedDifference.agency, "SSS");
  if (golden.expectedDifference.agency !== "SSS") throw Error("Incorrect test fixture");
  const altered: M10IndependentExpectation = {
    ...golden,
    expectedDifference: {
      ...golden.expectedDifference,
      employeeRegularCentavos: golden.expectedDifference.employeeRegularCentavos + 1,
      totalCentavos: golden.expectedDifference.totalCentavos + 1,
    },
  };
  const result = reconcileM10IndependentCentavos([first], [altered]);
  assert.equal(result.cases[0].reviewStatus, "CENTAVO_MISMATCH");
  assert.deepEqual(result.cases[0].arithmeticDiscrepancies.map(d => d.component),
    ["employeeRegularCentavos", "totalCentavos"]);
  assert.equal(result.cases[0].agencyCorrectionAuthorized, false);
});

test("M-10 corrupted totals, fractional and unsafe expectation cents fail closed", () => {
  const first = inputs[0], golden = expected[0];
  const changes = [
    { ...golden, expectedDifference: { ...golden.expectedDifference, totalCentavos: 0 } },
    { ...golden, expectedDifference: { ...golden.expectedDifference, totalCentavos: 1.25 } },
    { ...golden, expectedDifference: { ...golden.expectedDifference, totalCentavos: Number.MAX_SAFE_INTEGER + 1 } },
    { ...golden, expectationReference: "" },
  ];
  for (const bad of changes) {
    const row = reconcileM10IndependentCentavos([first], [bad]).cases[0];
    assert.equal(row.reviewStatus, "INDEPENDENT_EXPECTATION_INVALID");
    assert.equal(row.agencyCorrectionAuthorized, false);
  }
});

test("M-10 no source / wrong tenant / Draft run means no worksheet evidence", () => {
  for (const patch of [
    { sourceOrganizationId: 900 },
    { sourceEntryEmployeeId: 901 },
    { sourceRunStatus: "Draft" },
    { sourceRunId: null },
    { sourceEntryId: null },
    { sourcePeriodStart: "2026-10-31", sourcePeriodEnd: "2026-10-01" },
  ]) {
    const row = reconcileM10IndependentCentavos([{ ...inputs[0], ...patch }], [expected[0]]).cases[0];
    assert.equal(row.reviewStatus, "SOURCE_EVIDENCE_INVALID");
    assert.equal(row.hypotheticalDifference, null);
    assert.equal(row.originalWorksheetShares, null);
    assert.equal(row.agencyCorrectionAuthorized, false);
  }
});

test("M-10 Dec/Jan and Jan/Feb cutovers remain work-month evidence, never statutory filing instruction", () => {
  const boundary = inputs.filter(row => row.caseId.endsWith("-10") || row.caseId.endsWith("-11"));
  const result = reconcileM10IndependentCentavos(boundary, expected);
  assert.equal(result.cases.length, 8);
  assert.ok(result.cases.every(row => row.reviewStatus === "MATH_MATCH_ONLY"));
  assert.ok(result.cases.every(row => row.sourceWorkMonth !== row.payrollCorrectionMonth));
  assert.ok(result.cases.every(row => row.candidateContributionMonth === null));
  assert.ok(result.cases.every(row => !row.agencyCorrectionAuthorized));
});

test("M-10 signed false claims or acknowledgeExceptions never authorize payroll/agency release", () => {
  const input = { ...inputs[6], acknowledgeExceptions: true, candidateContributionMonth: "2026-09" };
  const row = reconcileM10IndependentCentavos([input], [expected[6]]).cases[0];
  assert.equal(row.reviewStatus, "MATH_MATCH_ONLY");
  assert.equal(row.candidateContributionMonth, "2026-09");
  assert.equal(row.agencyAccepted, false);
  assert.equal(row.agencyCorrectionAuthorized, false);
  assert.equal(row.payrollReleaseAuthorized, false);
});

test("M-10 report fingerprint is independent of case/expected list ordering", () => {
  const first = reconcileM10IndependentCentavos(inputs, expected);
  const reversed = reconcileM10IndependentCentavos([...inputs].reverse(), [...expected].reverse());
  assert.equal(first.reviewFingerprintSha256, reversed.reviewFingerprintSha256);
  const changed = reconcileM10IndependentCentavos(
    [{ ...inputs[0], wageDeltaCentavos: inputs[0].wageDeltaCentavos + 1 }, ...inputs.slice(1)],
    expected,
  );
  assert.notEqual(changed.reviewFingerprintSha256, first.reviewFingerprintSha256);
});

test("M-10 extra expectation rows are visible, not silently marked as accepted", () => {
  const extra: M10IndependentExpectation = {
    ...expected[0],
    caseId: "fictional-extra-unmatched",
  };
  const result = reconcileM10IndependentCentavos([inputs[0]], [expected[0], extra]);
  assert.deepEqual(result.unexpectedExpectationIds, ["fictional-extra-unmatched"]);
  assert.equal(result.cases[0].reviewStatus, "MATH_MATCH_ONLY");
  assert.equal(result.agencyCorrectionAuthorized, false);
});
