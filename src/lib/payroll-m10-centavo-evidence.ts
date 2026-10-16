/**
 * M-10 independently supplied, CASE-BY-CASE centavo review.
 *
 * This is intentionally limited to arithmetic review of hypothetical input
 * worksheets. It never selects a statutory month, contribution schedule,
 * accepted remittance or refund. A matching golden does NOT authorize filing.
 *
 * Do not aggregate the alternative fictional scenarios into a payable total:
 * multiple rows represent mutually exclusive possible employer histories.
 */
import { createHash } from "node:crypto";
import {
  buildM10ReadOnlyReview,
  type M10Agency,
  type M10ReviewInput,
  type M10WorksheetDifference,
} from "./payroll-m10-readonly-review";

export type M10IndependentExpectation = Readonly<{
  caseId: string;
  agency: M10Agency;
  organizationId: number;
  employeeId: number;
  adjustmentId: number;
  /** Independently authored test expectation; never approved liability. */
  expectedDifference: M10WorksheetDifference;
  /** Source of this TEST expectation. Not an official receipt. */
  expectationReference: string;
}>;

export type M10LedgerStatus =
  | "SOURCE_EVIDENCE_INVALID"
  | "DUPLICATE_CASE_ID"
  | "INDEPENDENT_EXPECTATION_MISSING"
  | "INDEPENDENT_EXPECTATION_DUPLICATE"
  | "INDEPENDENT_EXPECTATION_SCOPE_MISMATCH"
  | "INDEPENDENT_EXPECTATION_INVALID"
  | "WORKSHEET_DIFFERENCE_UNAVAILABLE"
  | "CENTAVO_MISMATCH"
  | "MATH_MATCH_ONLY";

export type M10ComponentDiscrepancy = Readonly<{
  component: string;
  expectedCentavos: number;
  observedCentavos: number;
}>;

export type M10CentavoLedgerRow = Readonly<{
  caseId: string;
  organizationId: number;
  employeeId: number;
  adjustmentId: number;
  agency: M10Agency;
  sourceWorkMonth: string | null;
  payrollCorrectionMonth: string | null;
  /** A hypothetical review month is never a certified contribution month. */
  candidateContributionMonth: string | null;
  sourceProofIssues: readonly string[];
  remittanceState: M10ReviewInput["remittanceState"];
  wageDeltaCentavos: number | null;
  originalWorksheetShares: M10ReviewInput["originalWorksheetShares"];
  revisedWorksheetShares: M10ReviewInput["revisedWorksheetShares"];
  hypotheticalDifference: M10WorksheetDifference | null;
  independentExpectedDifference: M10WorksheetDifference | null;
  expectationReference: string | null;
  arithmeticDiscrepancies: readonly M10ComponentDiscrepancy[];
  reviewStatus: M10LedgerStatus;
  /** NEVER a calculation authority, not even after a synthetic match. */
  agencyCorrectionAuthorized: false;
  agencyAccepted: false;
  payrollReleaseAuthorized: false;
}>;

export type M10CentavoEvidenceReport = Readonly<{
  scope: "SYNTHETIC_OR_READ_ONLY_INSPECTION";
  statutoryDecision: "NOT_OBTAINED";
  officialAgencyPosting: "NOT_TESTED";
  agencyCorrectionAuthorized: false;
  /** Content-only fingerprint; not an agency signature or receipt. */
  reviewFingerprintSha256: string;
  counts: Readonly<Record<M10LedgerStatus, number>>;
  unexpectedExpectationIds: readonly string[];
  cases: readonly M10CentavoLedgerRow[];
}>;

function validCentavos(value: number): boolean {
  return Number.isSafeInteger(value);
}

function differencesFor(
  expected: M10WorksheetDifference,
  observed: M10WorksheetDifference,
): M10ComponentDiscrepancy[] | null {
  if (expected.agency !== observed.agency) return null;
  let parts: Array<readonly [string, number, number]>;
  if (expected.agency === "SSS" && observed.agency === "SSS") {
    parts = [
      ["employeeRegularCentavos", expected.employeeRegularCentavos, observed.employeeRegularCentavos],
      ["employeeMpfCentavos", expected.employeeMpfCentavos, observed.employeeMpfCentavos],
      ["employerRegularCentavos", expected.employerRegularCentavos, observed.employerRegularCentavos],
      ["employerMpfCentavos", expected.employerMpfCentavos, observed.employerMpfCentavos],
      ["employerEcCentavos", expected.employerEcCentavos, observed.employerEcCentavos],
    ];
  } else if (expected.agency === "Pag-IBIG" && observed.agency === "Pag-IBIG") {
    parts = [
      ["employeeSavingsCentavos", expected.employeeSavingsCentavos, observed.employeeSavingsCentavos],
      ["employerSavingsCentavos", expected.employerSavingsCentavos, observed.employerSavingsCentavos],
    ];
  } else {
    return null;
  }
  if (!parts.every(([, a, b]) => validCentavos(a) && validCentavos(b))) return null;
  const expectedSum = parts.reduce((a, [, value]) => a + value, 0);
  const observedSum = parts.reduce((a, [, , value]) => a + value, 0);
  if (!validCentavos(expectedSum) || !validCentavos(observedSum)
    || !validCentavos(expected.totalCentavos) || !validCentavos(observed.totalCentavos)
    || expectedSum !== expected.totalCentavos || observedSum !== observed.totalCentavos) {
    return null;
  }
  return [
    ...parts.filter(([, a, b]) => a !== b).map(([component, a, b]) => ({
      component, expectedCentavos: a, observedCentavos: b,
    })),
    ...(expected.totalCentavos !== observed.totalCentavos
      ? [{ component: "totalCentavos", expectedCentavos: expected.totalCentavos, observedCentavos: observed.totalCentavos }]
      : []),
  ];
}

/**
 * The caller supplies a second, independently authored ledger expectation.
 * No database queries, mutable state, side effects, rate formulas or agency I/O.
 */
export function reconcileM10IndependentCentavos(
  inputs: readonly M10ReviewInput[],
  expectations: readonly M10IndependentExpectation[],
): M10CentavoEvidenceReport {
  const reviews = buildM10ReadOnlyReview(inputs);
  const expectedById = new Map<string, M10IndependentExpectation[]>();
  for (const candidate of expectations) {
    const list = expectedById.get(candidate.caseId) ?? [];
    list.push(candidate);
    expectedById.set(candidate.caseId, list);
  }
  const caseCounts = new Map<string, number>();
  for (const item of inputs) {
    caseCounts.set(item.caseId, (caseCounts.get(item.caseId) ?? 0) + 1);
  }

  const cases: M10CentavoLedgerRow[] = inputs.map((item, index) => {
    const review = reviews[index];
    const matches = expectedById.get(item.caseId) ?? [];
    const expectation = matches.length === 1 ? matches[0] : null;
    let status: M10LedgerStatus;
    let differences: M10ComponentDiscrepancy[] = [];

    if ((caseCounts.get(item.caseId) ?? 0) > 1) {
      status = "DUPLICATE_CASE_ID";
    } else if (review.evidenceStatus === "NEEDS_EVIDENCE") {
      status = "SOURCE_EVIDENCE_INVALID";
    } else if (!matches.length) {
      status = "INDEPENDENT_EXPECTATION_MISSING";
    } else if (matches.length !== 1) {
      status = "INDEPENDENT_EXPECTATION_DUPLICATE";
    } else if (!expectation
      || expectation.agency !== item.agency
      || expectation.organizationId !== item.organizationId
      || expectation.employeeId !== item.employeeId
      || expectation.adjustmentId !== item.adjustmentId) {
      status = "INDEPENDENT_EXPECTATION_SCOPE_MISMATCH";
    } else if (!expectation.expectationReference.trim()
      || !review.hypotheticalWorksheetDifference) {
      status = !review.hypotheticalWorksheetDifference
        ? "WORKSHEET_DIFFERENCE_UNAVAILABLE"
        : "INDEPENDENT_EXPECTATION_INVALID";
    } else {
      const checked = differencesFor(expectation.expectedDifference, review.hypotheticalWorksheetDifference);
      if (checked === null) {
        status = "INDEPENDENT_EXPECTATION_INVALID";
      } else {
        differences = checked;
        status = checked.length ? "CENTAVO_MISMATCH" : "MATH_MATCH_ONLY";
      }
    }

    return {
      caseId: item.caseId,
      organizationId: item.organizationId,
      employeeId: item.employeeId,
      adjustmentId: item.adjustmentId,
      agency: item.agency,
      sourceWorkMonth: review.sourceWorkMonth,
      payrollCorrectionMonth: review.payrollCorrectionMonth,
      candidateContributionMonth: review.candidateContributionMonth,
      sourceProofIssues: review.evidenceIssues,
      remittanceState: item.remittanceState,
      wageDeltaCentavos: review.wageDeltaCentavos,
      originalWorksheetShares: review.evidenceStatus === "NEEDS_EVIDENCE" ? null : item.originalWorksheetShares ?? null,
      revisedWorksheetShares: review.evidenceStatus === "NEEDS_EVIDENCE" ? null : item.revisedWorksheetShares ?? null,
      hypotheticalDifference: review.hypotheticalWorksheetDifference,
      independentExpectedDifference: expectation?.expectedDifference ?? null,
      expectationReference: expectation?.expectationReference ?? null,
      arithmeticDiscrepancies: differences,
      reviewStatus: status,
      agencyCorrectionAuthorized: false,
      agencyAccepted: false,
      payrollReleaseAuthorized: false,
    };
  });

  const counts: Record<M10LedgerStatus, number> = {
    SOURCE_EVIDENCE_INVALID: 0,
    DUPLICATE_CASE_ID: 0,
    INDEPENDENT_EXPECTATION_MISSING: 0,
    INDEPENDENT_EXPECTATION_DUPLICATE: 0,
    INDEPENDENT_EXPECTATION_SCOPE_MISMATCH: 0,
    INDEPENDENT_EXPECTATION_INVALID: 0,
    WORKSHEET_DIFFERENCE_UNAVAILABLE: 0,
    CENTAVO_MISMATCH: 0,
    MATH_MATCH_ONLY: 0,
  };
  for (const row of cases) counts[row.reviewStatus] += 1;
  const inputIds = new Set(inputs.map(item => item.caseId));
  const unexpectedExpectationIds = [...expectedById.keys()]
    .filter(id => !inputIds.has(id))
    .sort();
  const canonical = {
    cases: [...cases].sort((a, b) =>
      a.caseId.localeCompare(b.caseId)
      || a.organizationId - b.organizationId
      || a.employeeId - b.employeeId
      || a.adjustmentId - b.adjustmentId
      || a.agency.localeCompare(b.agency)
    ),
    unexpectedExpectationIds,
  };
  const reviewFingerprintSha256 = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  return {
    scope: "SYNTHETIC_OR_READ_ONLY_INSPECTION",
    statutoryDecision: "NOT_OBTAINED",
    officialAgencyPosting: "NOT_TESTED",
    agencyCorrectionAuthorized: false,
    reviewFingerprintSha256,
    counts,
    unexpectedExpectationIds,
    cases,
  };
}
