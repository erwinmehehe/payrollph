/**
 * Solo-dev, entirely fictional M-10 review pack. No DB, real employee,
 * actual agency receipt, statutory policy inference, remittance, or payout.
 *
 * Run: npx tsx scripts/m10-synthetic-review.ts
 * Full case matrix: npx tsx scripts/m10-synthetic-review.ts --rows
 */
import { buildM10ReadOnlyReview } from "../src/lib/payroll-m10-readonly-review";
import { createM10FictionalCases } from "../tests/fixtures/m10-retro-agency-cases";

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
