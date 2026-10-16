/**
 * Solo-dev, entirely fictional M-10 review pack. No DB, real employee,
 * actual agency receipt, statutory policy inference, remittance, or payout.
 *
 * Run: npx tsx scripts/m10-synthetic-review.ts
 * Full case matrix: npx tsx scripts/m10-synthetic-review.ts --rows
 */
import { buildM10ReadOnlyReview } from "../src/lib/payroll-m10-readonly-review";
import { createM10FictionalCases } from "../tests/fixtures/m10-retro-agency-cases";
import { reconcileM10IndependentCentavos } from "../src/lib/payroll-m10-centavo-evidence";
import { createIndependentM10FictionalExpected } from "../tests/fixtures/m10-independent-centavo-golden";


if (process.argv.includes("--independent-ledger") || process.argv.includes("--independent-summary")) {
  const evidence = reconcileM10IndependentCentavos(
    createM10FictionalCases(),
    createIndependentM10FictionalExpected(),
  );
  if (evidence.cases.length !== 48
    || evidence.counts.MATH_MATCH_ONLY !== 44
    || evidence.counts.SOURCE_EVIDENCE_INVALID !== 4
    || evidence.cases.some(caseRow => caseRow.agencyCorrectionAuthorized || caseRow.agencyAccepted || caseRow.payrollReleaseAuthorized)
    || evidence.unexpectedExpectationIds.length !== 0) {
    throw new Error("M10_INDEPENDENT_SYNTHETIC_LEDGER_DID_NOT_RECONCILE");
  }
  const overview = {
    purpose: "FICTIONAL MATH CHECK ONLY - NOT STATUTORY OR AGENCY APPROVAL",
    hashNotAgencyReceipt: evidence.reviewFingerprintSha256,
    cases: evidence.cases.length,
    matchedHypotheticalMathCases: evidence.counts.MATH_MATCH_ONLY,
    invalidSourceCases: evidence.counts.SOURCE_EVIDENCE_INVALID,
    caseReviewCounts: evidence.counts,
    authorizedCorrections: 0,
    agencyAccepted: false,
    realGovernmentTransactions: 0,
  };
  console.log(JSON.stringify(
    process.argv.includes("--independent-ledger")
      ? { overview, cases: evidence.cases } : overview,
    null,
    2,
  ));
  process.exit(0);
}

const rows = buildM10ReadOnlyReview(createM10FictionalCases());
if (rows.length !== 48 || rows.some(row =>
  row.canPostAgencyCorrection || row.approvedAgencyLiabilityCentavos !== null
  || row.agencyFilingAction !== "NOT_AUTHORIZED"
)) {
  throw new Error("M10_SYNTHETIC_CASE_FAIL_CLOSED_VIOLATION");
}

const summary = {
  generatedAt: "synthetic-static-test-fixtures",
  purpose: "FICTIONAL REVIEW ONLY — NOT AGENCY APPROVAL",
  agencies: ["SSS", "Pag-IBIG"],
  fictionalEmployers: 2,
  scenariosPerEmployerPerAgency: 12,
  cases: rows.length,
  evidenceCompleteButPolicyUnresolved: rows.filter(row => row.evidenceStatus === "POLICY_UNRESOLVED").length,
  evidenceIncomplete: rows.filter(row => row.evidenceStatus === "NEEDS_EVIDENCE").length,
  hypotheticalWorksheetRows: rows.filter(row => row.hypotheticalWorksheetDifference !== null).length,
  authorizedCorrections: 0,
  authorizedFilings: 0,
  realAgencyReceipts: 0,
  stillRequired: [
    "Written SSS historical contribution/remittance correction treatment",
    "Written Pag-IBIG historical contribution/remittance correction treatment",
    "Actual agency submission/acceptance and member-posting evidence",
    "Qualified review of per-employee centavos and approved source revision",
  ],
};

console.log(JSON.stringify(
  process.argv.includes("--rows") ? { summary, rows } : summary,
  null,
  2,
));
