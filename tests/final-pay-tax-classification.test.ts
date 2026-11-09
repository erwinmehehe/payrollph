import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  privateVacationLeaveExemptDaysForDate,
  classifyPrivateVacationLeave,
  classifyReviewedSeparationPay,
} from "../src/lib/final-pay-tax-classification";
import { computeFinalPay } from "../src/lib/final-pay";
import { finalPayReviewCsv } from "../src/lib/final-pay-review-evidence";
import { priorExemptLeaveDaysInTaxYear, leaveTaxReleaseDateNeedsReconciliation, legacyFinalPayExemptionNeedsRecompute } from "../src/lib/final-pay-leave-tax-year";

const reference = "BIR-RR29-2025-private-VL-ledger-review-2026";

function leave(options: Partial<Parameters<typeof classifyPrivateVacationLeave>[0]> = {}) {
  return classifyPrivateVacationLeave({
    taxDate: "2026-11-08",
    leaveType: "Vacation leave",
    days: 15,
    dailyRate: 1000,
    annualExemptDaysPreviouslyUsed: 0,
    evidenceReference: reference,
    ...options,
  });
}

const basePay = {
  releasedBasicYtd: 600_000,
  historicalBasicYtd: 0,
  unpaidBasicSalary: 0,
  thirteenthPaidYtd: 0,
  grossCompensationYtd: 600_000,
  statutoryContributionsYtd: 0,
  taxWithheldYtd: 0,
  mwe: false,
  leaveMonetizationPay: 15_000,
  separationPay: 0,
  retirementPay: 0,
  otherBenefits: 0,
  loanDeductions: 0,
};

test("RR 29-2025 starts on 2026-01-06; private annual exemption is 10 then 12 days", () => {
  assert.equal(privateVacationLeaveExemptDaysForDate("2025-12-31"), 10);
  assert.equal(privateVacationLeaveExemptDaysForDate("2026-01-05"), 10);
  assert.equal(privateVacationLeaveExemptDaysForDate("2026-01-06"), 12);
  assert.equal(privateVacationLeaveExemptDaysForDate("2026-11-08"), 12);
  assert.deepEqual([leave({ taxDate: "2025-12-31" }).deMinimisPay,
    leave({ taxDate: "2026-01-05" }).deMinimisPay,
    leave({ taxDate: "2026-01-06" }).deMinimisPay], [10_000, 10_000, 12_000]);
  for (const date of ["2026-02-30", "2026-13-01", "junk"]) {
    assert.throws(() => privateVacationLeaveExemptDaysForDate(date), /date is invalid/);
  }
});

test("verified 15 days = 12 days de minimis and 3 days in shared benefits pool, never 15k taxable", () => {
  const result = leave();
  assert.equal(result.annualExemptDayLimit, 12);
  assert.equal(result.exemptDaysThisPay, 12);
  assert.equal(result.grossPay, 15000);
  assert.equal(result.deMinimisPay, 12000);
  assert.equal(result.benefitsPoolPay, 3000);
  assert.equal(result.directTaxablePay, 0);
});

test("prior annual converted days and fractional-centavo cash splits stay exact", () => {
  const result = leave({
    days: 2.5,
    dailyRate: 1363.67,
    annualExemptDaysPreviouslyUsed: 10.7,
  });
  assert.equal(result.exemptDaysThisPay, 1.3);
  assert.equal(result.benefitsPoolPay > 0, true);
  assert.equal(Math.round(result.deMinimisPay * 100) + Math.round(result.benefitsPoolPay * 100),
    Math.round(result.grossPay * 100));
  assert.equal(leave({ annualExemptDaysPreviouslyUsed: 12 }).deMinimisPay, 0);
  assert.equal(leave({ days: 5 }).benefitsPoolPay, 0);
});

test("non-vacation and unverified or malformed leave inputs never receive automatic exemption", () => {
  for (const leaveType of ["Sick leave", "Service incentive leave", "Mixed leave", ""]) {
    assert.throws(() => leave({ leaveType }), /verified unused vacation leave/);
  }
  assert.throws(() => leave({ evidenceReference: "no" }), /supporting evidence reference/);
  for (const days of [0, -1, Number.NaN, 0.15]) {
    assert.throws(() => leave({ days }), /day|positive/i);
  }
  assert.throws(() => leave({ annualExemptDaysPreviouslyUsed: -1 }), /non-negative/);
});

test("annualized tax includes gross leave once then deducts de minimis and 90k pool", () => {
  const v = leave();
  const classified = computeFinalPay({
    ...basePay,
    deMinimisLeaveMonetizationPay: v.deMinimisPay,
    benefitPoolLeaveMonetizationPay: v.benefitsPoolPay,
  });
  assert.equal(classified.thirteenthEntitlement, 50_000);
  assert.equal(classified.annualization.grossCompensation, 665_000);
  assert.equal(classified.annualization.deMinimis, 12_000);
  assert.equal(classified.annualization.benefitPool, 53_000);
  assert.equal(classified.annualization.taxableIncome, 600_000);
  assert.equal(classified.taxDue, 62_500);
  assert.equal(classified.grossFinalPay, 65_000);
  const legacy = computeFinalPay({ ...basePay, taxableLeaveMonetizationPay: 15_000 });
  assert.equal(legacy.annualization.taxableIncome, 615_000);
  assert.equal(legacy.taxDue, 65_500);
});

test("90k pool exhausted by 13th month taxes the correct leave excess, not de minimis", () => {
  const r = computeFinalPay({
    ...basePay,
    releasedBasicYtd: 1_200_000,
    grossCompensationYtd: 1_200_000,
    deMinimisLeaveMonetizationPay: 12_000,
    benefitPoolLeaveMonetizationPay: 3_000,
  });
  assert.equal(r.thirteenthEntitlement, 100_000);
  assert.equal(r.annualization.benefitPool, 103_000);
  assert.equal(r.annualization.exemptBenefitPool, 90_000);
  assert.equal(r.annualization.taxableBenefitPool, 13_000);
  assert.equal(r.annualization.taxableIncome, 1_213_000);
  assert.equal(r.taxDue, 205_750);
});

test("MWE does not double-count leave excess as both supplementary compensation and pool", () => {
  const r = computeFinalPay({
    ...basePay,
    mwe: true,
    mweTaxableSupplementaryCompensationYtd: 260_000,
    deMinimisLeaveMonetizationPay: 12_000,
    benefitPoolLeaveMonetizationPay: 3_000,
  });
  assert.equal(r.annualization.taxableIncome, 260_000);
  assert.equal(r.taxDue, 1_500);
});

test("invalid or contradictory leave tax buckets fail closed", () => {
  assert.throws(() => computeFinalPay({
    ...basePay, deMinimisLeaveMonetizationPay: 12_000,
    benefitPoolLeaveMonetizationPay: 4_000,
  }), /allocations exceed/);
  assert.throws(() => computeFinalPay({
    ...basePay, deMinimisLeaveMonetizationPay: 12_000,
    benefitPoolLeaveMonetizationPay: 3_000,
    taxableLeaveMonetizationPay: 15_000,
  }), /conflicts with reviewed/);
  assert.throws(() => computeFinalPay({
    ...basePay, deMinimisLeaveMonetizationPay: Number.NaN,
  }), /Invalid reviewed/);
});

test("evidenced authorized-cause separation pay can be partly exempt without changing gross payout", () => {
  const reviewed = classifyReviewedSeparationPay({
    separationPay: 200_000, taxableAmount: 50_000,
    exemptionReason: "redundancy", evidenceReference: "BIR-CTE-2026-EXAMPLE-0003",
    separationType: "authorized_cause",
  });
  assert.equal(reviewed.exemptPay, 150_000);
  assert.equal(reviewed.taxablePay, 50_000);
  const partial = computeFinalPay({
    ...basePay, leaveMonetizationPay: 0, separationPay: 200_000,
    taxableSeparationPay: reviewed.taxablePay,
  });
  const fullyTaxable = computeFinalPay({
    ...basePay, leaveMonetizationPay: 0, separationPay: 200_000,
  });
  assert.equal(partial.grossFinalPay, fullyTaxable.grossFinalPay);
  assert.equal(partial.annualization.taxableIncome, 650_000);
  assert.equal(fullyTaxable.annualization.taxableIncome, 800_000);
  assert.equal(partial.taxDue, 72_500);
  assert.equal(fullyTaxable.taxDue, 102_500);
});

test("absence of evidence cannot quietly exempt separation pay", () => {
  const full = classifyReviewedSeparationPay({ separationPay: 200_000, separationType: "resignation" });
  assert.equal(full.taxablePay, 200_000);
  for (const input of [
    { separationPay: 200_000, taxableAmount: 0, separationType: "resignation",
      exemptionReason: "redundancy", evidenceReference: "BIR-CTE-EXAMPLE-2026" },
    { separationPay: 200_000, taxableAmount: 0, separationType: "authorized_cause",
      exemptionReason: "not_a_cause", evidenceReference: "BIR-CTE-EXAMPLE-2026" },
    { separationPay: 200_000, taxableAmount: 0, separationType: "authorized_cause",
      exemptionReason: "redundancy", evidenceReference: "" },
    { separationPay: 200_000, taxableAmount: 200_001, separationType: "authorized_cause" },
    { separationPay: 200_000, taxableAmount: -1, separationType: "authorized_cause" },
  ]) {
    assert.throws(() => classifyReviewedSeparationPay(input), /exempt|reason|evidence|exceed|non-negative|authorized/i);
  }
});


test("prior exempt vacation days use the released payroll payment year, not row creation year", () => {
  const conversions = [
    { id: 1, status: "paid", taxExempt: true, daysConverted: "7.0",
      payrollRunId: 21, createdAt: new Date("2026-01-15T00:00:00Z") },
    { id: 2, status: "paid", taxExempt: true, daysConverted: "4.5",
      payrollRunId: 22, createdAt: new Date("2025-12-20T00:00:00Z") },
    { id: 3, status: "rejected", taxExempt: true, daysConverted: "99.0",
      payrollRunId: null, createdAt: new Date("2026-06-01T00:00:00Z") },
    { id: 4, status: "paid", taxExempt: false, daysConverted: "6.0",
      payrollRunId: null, createdAt: new Date("2026-06-01T00:00:00Z") },
  ];
  const payrollRuns = [
    { id: 21, organizationId: 9, status: "Released", payDate: "2025-12-30" },
    { id: 22, organizationId: 9, status: "Released", payDate: "2026-01-06" },
  ];
  assert.equal(priorExemptLeaveDaysInTaxYear({
    organizationId: 9, taxDate: "2025-12-31", conversions, payrollRuns,
  }), 7);
  assert.equal(priorExemptLeaveDaysInTaxYear({
    organizationId: 9, taxDate: "2026-11-08", conversions, payrollRuns,
  }), 4.5);
});

test("unverified previous leave payment year fails closed, not guessed from createdAt", () => {
  const conversion = {
    id: 10, status: "paid", taxExempt: true, daysConverted: "3.0",
    payrollRunId: null, createdAt: new Date("2026-02-01T00:00:00Z"),
  };
  const fixture = {
    organizationId: 9, taxDate: "2026-12-31", conversions: [conversion],
    payrollRuns: [{ id: 24, organizationId: 9, status: "Released", payDate: "2026-02-01" }],
  };
  assert.throws(() => priorExemptLeaveDaysInTaxYear(fixture), /FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED/);
  for (const run of [
    { id: 24, organizationId: 10, status: "Released", payDate: "2026-02-01" },
    { id: 24, organizationId: 9, status: "Draft", payDate: "2026-02-01" },
    { id: 24, organizationId: 9, status: "Released", payDate: "not-a-date" },
  ]) {
    assert.throws(() => priorExemptLeaveDaysInTaxYear({
      ...fixture, conversions: [{ ...conversion, payrollRunId: 24 }], payrollRuns: [run],
    }), /FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED/);
  }
});

test("manual release holds missing, future or cross-year leave payout evidence", () => {
  const review = { leaveTaxBasis: "private_vacation_de_minimis", taxDate: "2026-12-31" };
  assert.equal(leaveTaxReleaseDateNeedsReconciliation(review, "2026-12-31", "2026-12-31"), false);
  for (const date of [undefined, "", "2027-01-05", "2026-12-30", "2030-01-01", "2026-02-30"]) {
    assert.equal(leaveTaxReleaseDateNeedsReconciliation(review, date, "2027-01-06"), true,
      "A moved/unknown payment date requires a fresh signed tax review");
  }
  assert.equal(leaveTaxReleaseDateNeedsReconciliation(review, "2026-12-31", "2026-12-30"), true,
    "Cannot attest a payment date in the future");
  assert.equal(leaveTaxReleaseDateNeedsReconciliation(
    { leaveTaxBasis: "taxable", taxDate: "2026-12-31" }, undefined, "2027-01-01",
  ), false, "Fully taxable leave cannot be blocked by private-de-minimis evidence");
});

test("old checkbox-only exemptions cannot pass approval or release without Phase 7 tax review", () => {
  const reviewed = {
    reviewerUserId: 18, taxDate: "2026-11-08",
    leaveTaxBasis: "private_vacation_de_minimis",
    leave: { deMinimisPay: 12000, benefitsPoolPay: 0,
      evidenceReference: "SYNTHETIC-LEAVE-LEDGER-2026" },
    separation: { grossPay: 10000, taxablePay: 0, exemptPay: 10000,
      exemptionReason: "redundancy", evidenceReference: "SYNTHETIC-CTE-2026" },
  };
  assert.equal(legacyFinalPayExemptionNeedsRecompute({
    leaveMonetizationTaxExempt: false, separationPayTaxExempt: false,
  }), false, "fully taxable historical package must not gain an exemption");
  for (const claim of [
    { leaveMonetizationTaxExempt: true },
    { separationPayTaxExempt: true },
    { leaveMonetizationTaxExempt: true, taxClassification: {} },
    { separationPayTaxExempt: true, taxClassification: reviewed && { ...reviewed, separation: null } },
    { leaveMonetizationTaxExempt: true,
      taxClassification: { ...reviewed, leave: { ...reviewed.leave, evidenceReference: "" } } },
  ]) assert.equal(legacyFinalPayExemptionNeedsRecompute(claim), true,
    "legacy exemption without complete evidence requires recomputation");
  assert.equal(legacyFinalPayExemptionNeedsRecompute({
    leaveMonetizationTaxExempt: true, separationPayTaxExempt: true,
    taxClassification: reviewed,
  }), false, "new evidence-backed split remains releasable through the other checks");
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  for (const phase of ["snapshot", "frozen", "freshSnapshot"]) {
    assert.ok(route.includes("legacyFinalPayExemptionNeedsRecompute(" + phase + ")"),
      "missing fail-closed legacy gate in " + phase + " approval/release path");
  }
  assert.match(route, /FINAL_PAY_LEGACY_TAX_REVIEW_REQUIRED/);
});

test("Finance approval revalidates the linked Released payroll tax year inside its transaction", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const approval = route.slice(route.indexOf('if (action === "approve") {'),
    route.indexOf('if (sep.status !== "approved") {'));
  const start = approval.indexOf("const approvalTaxReview = frozen.taxClassification");
  const check = approval.indexOf("await verifiedPriorLeaveExemptDays", start);
  const compare = approval.indexOf("priorDays !== recordedLeave.annualExemptDaysPreviouslyUsed", check);
  const update = approval.indexOf('status: "approved"', compare);
  assert.ok(start >= 0 && check > start && compare > check && update > compare,
    "approval must re-read and compare tax-year evidence inside the locked transaction before updating status");
  assert.match(approval.slice(start, update),
    /taxDate: String\(approvalTaxReview\.taxDate \?\? ""\)/);
  assert.match(approval.slice(start, update),
    /tx as unknown as Pick<typeof db, "select">/);
  assert.match(approval.slice(start, update), /FINAL_PAY_LEAVE_TAX_HISTORY_CHANGED/);
});

test("Separation route holds stale annual leave evidence and payout-year changes at release", () => {
  const source = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.ok(!source.includes("new Date(row.createdAt)"), "createdAt must not classify a prior leave tax year");
  assert.match(source, /annualExemptDaysPreviouslyUsed = await verifiedPriorLeaveExemptDays/);
  assert.match(source, /FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED/);
  assert.match(source, /actualPriorDays !== frozenLeave.annualExemptDaysPreviouslyUsed/);
  assert.match(source, /leaveTaxReleaseDateNeedsReconciliation\(\s*releaseTaxClassification/);
  assert.match(source, /leaveTaxReleaseDateNeedsReconciliation\(\s*freshSnapshot.taxClassification/);
  assert.match(source, /FINAL_PAY_LEAVE_PAYOUT_DATE_REVIEW_REQUIRED/);
  const component = readFileSync("src/components/separation-panel.tsx", "utf8");
  assert.match(component, /actualLeavePayoutDate/);
});

test("production route keeps review gates, evidence in snapshot and full-pay release controls", () => {
  const source = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.match(source, /if \(leaveMonetizationPay > 0 && !leaveTaxReviewed\)/);
  assert.match(source, /if \(\(separationPay > 0 \|\| retirementPay > 0\) && !specialPayTaxReviewed\)/);
  assert.match(source, /classifyPrivateVacationLeave\(/);
  assert.match(source, /classifyReviewedSeparationPay\(/);
  assert.match(source, /deMinimisLeaveMonetizationPay: leaveTax\?\.deMinimisPay/);
  assert.match(source, /benefitPoolLeaveMonetizationPay: leaveTax\?\.benefitsPoolPay/);
  assert.match(source, /taxableSeparationPay: separationTax\.taxablePay/);
  assert.match(source, /taxClassification: \{/);
  assert.match(source, /sourceFingerprint/);
  assert.match(source, /FINAL_PAY_MANDATORY_SHORTFALL_REVIEW_REQUIRED/);
  assert.match(source, /FINAL_PAY_MAKER_CHECKER_REQUIRED/);
});

test("final-pay review CSV surfaces tax split and evidence, including safe formula quoting", () => {
  const csv = finalPayReviewCsv({
    id: 12, employeeNo: "TEST-12", employeeName: "Fictional Worker",
    grossFinalPay: "215000.00", netFinalPay: "150000.00",
    taxAdjustment: "-65000.00", finalStatutoryDeductions: "0.00",
    loanDeductions: "0.00",
    computationSnapshot: {
      taxClassification: {
        reviewerUserId: 19, taxDate: "2026-11-08",
        leaveTaxBasis: "private_vacation_de_minimis",
        leave: {
          deMinimisPay: 12000, benefitsPoolPay: 3000,
          evidenceReference: "=REVIEW_LEDGER_2026",
        },
        separation: {
          taxablePay: 50000, exemptPay: 150000,
          exemptionReason: "redundancy",
          evidenceReference: "CTE-REFERENCE-SYNTHETIC",
        },
      },
    },
  });
  assert.match(csv, /"Leave de minimis \(PHP\)","12000\.00"/);
  assert.match(csv, /"Leave excess in combined 90k benefits pool \(PHP\)","3000\.00"/);
  assert.match(csv, /"Separation taxable portion \(PHP\)","50000\.00"/);
  assert.match(csv, /"Separation exempt portion \(PHP\)","150000\.00"/);
  assert.match(csv, /"Separation tax-exemption reason","redundancy"/);
  assert.match(csv, /"Leave review evidence reference","'=REVIEW_LEDGER_2026"/);
});


test("Phase 7 separation source re-inventory preserves existing tenant evidence, no new credits", () => {
  const path = "src/app/api/separation/route.ts";
  const sourceBytes = readFileSync(path);
  const fingerprint = createHash("sha1")
    .update("blob " + sourceBytes.length).update(Buffer.from([0]))
    .update(sourceBytes).digest("hex");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = manifest.allApiRouteFiles[path];
  const review = record.sourceRevisionReview;
  assert.equal(record.gitBlobSha, fingerprint, "route changes require fresh source review");
  assert.equal(review.previousRouteBlobSha, "3cc5c7408d52dd0a0fe2c784d95466650acf9f8a");
  assert.equal(review.currentRouteBlobSha, fingerprint);
  assert.deepEqual(review.changedMethods, ["POST", "PATCH"]);
  assert.equal(review.priorTenantIsolationHttpProof, "scripts/qa/payroll-approved-exit-http.mjs");
  assert.equal(review.taxContractFile, "tests/final-pay-tax-classification.test.ts");
  assert.equal(review.newTenantIsolationMethodCredits, 0);
  assert.equal(review.exactHeadFullSuite, "PENDING");
  assert.equal(review.independentPhilippineTaxAndSecurityReview, "PENDING");
  assert.equal(review.productionCertified, false);
  assert.deepEqual(record.methods.map((m: { name: string; status: string }) => [m.name, m.status]),
    [["GET", "COVERED"], ["POST", "COVERED"], ["PATCH", "COVERED"]],
    "this source reconciliation must not inflate tenant-isolation method credits");
  const tenantProof = readFileSync(review.priorTenantIsolationHttpProof, "utf8");
  for (const token of [
    "Actual Separation POST creates package", "Owned Separation GET",
    "Foreign GET denied", "Foreign POST denied", "Foreign PATCH denied",
    "Foreign separation mutations leave victim rows unchanged",
  ]) assert.ok(tenantProof.includes(token), "existing reviewed tenant proof missing: " + token);
  const source = sourceBytes.toString("utf8");
  const post = source.slice(source.indexOf("export async function POST("), source.indexOf("export async function PATCH("));
  for (const guard of [
    "enforceSameOriginMutation(request)", "getSessionUser()", "assertOrganizationRole(",
    "getAccess(", "classifyPrivateVacationLeave(", "classifyReviewedSeparationPay(",
    "taxableSeparationPay: separationTax.taxablePay",
    "benefitPoolLeaveMonetizationPay: leaveTax?.benefitsPoolPay",
    "deMinimisLeaveMonetizationPay: leaveTax?.deMinimisPay",
  ]) assert.ok(post.includes(guard), "Phase 7 re-inventory lost a reviewed guard: " + guard);
});
