import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeFinalPay } from "../src/lib/final-pay";
import type { PriorEvidence } from "../src/lib/year-end-prior-evidence";

// RR 11-2018, amended RR 2-98 section 2.79(B)(5)(b), Steps 1-4:
// on termination, annualize prior-employer taxable compensation and credit
// withholding paid to that employer. Figures below are hand-derived from the
// existing Phase 12 fictional worker, not sampled from the payroll engine.
const present = {
  releasedBasicYtd: 180_000,
  historicalBasicYtd: 0,
  unpaidBasicSalary: 0,
  thirteenthPaidYtd: 0,
  grossCompensationYtd: 180_000,
  statutoryContributionsYtd: 14_700,
  taxWithheldYtd: 6_044.40,
  mwe: false,
  leaveMonetizationPay: 0,
  separationPay: 0,
  retirementPay: 0,
  otherBenefits: 0,
  loanDeductions: 0,
} as const;

const verified: PriorEvidence = {
  status: "verified",
  employerName: "Fictional Previous Employer",
  employerTin: "123456789-0000",
  periodFrom: "2026-01-01",
  periodTo: "2026-06-30",
  taxableIncome: "165000.00",
  taxWithheld: "1500.00",
  exemptBenefits: "0.00",
  sourceReference: "FICTIONAL-2316-PRIOR-EMPLOYER",
  sourceSha256: "a".repeat(64),
  peraCredit: "0.00",
  peraReference: "",
  peraSha256: "",
};

test("RR 11-2018: prior employer changes separation annualization, not 13th-month earned at current employer", () => {
  const actual = computeFinalPay({ ...present, priorEmployerEvidence: { evidence: verified, taxYear: 2026 } });
  // Current employer: 180,000 basic + 15,000 accrued 13th - 14,700 contributions = 165,300 taxable.
  // Prior employer: 165,000 taxable; combined: 330,300.
  // RR 11-2018 Annex E effective 2023: (330,300 - 250,000) * 15% = 12,045.00.
  // Collect 12,045 - previous WHT 1,500 - current WHT 6,044.40 = 4,500.60.
  assert.equal(actual.thirteenthEntitlement, 15_000);
  assert.equal(actual.thirteenthDue, 15_000);
  assert.equal(actual.annualization.taxableIncome, 165_300, "present employer taxable remains separate");
  assert.equal(actual.annualization.taxWithheld, 6_044.40, "prior withholding must never appear as current-employer WHT");
  assert.equal(actual.taxDue, 12_045);
  assert.equal(actual.taxAdjustment, -4_500.60);
  assert.equal(actual.grossFinalPay, 15_000);
  assert.equal(actual.netFinalPay, 10_499.40);
});

test("RR 11-2018 and NIRC 32(B)(7)(e): prior benefits consume the same 90,000 annual pool", () => {
  const actual = computeFinalPay({
    ...present,
    priorEmployerEvidence: { evidence: { ...verified, exemptBenefits: "80000.00" }, taxYear: 2026 },
  });
  // 80,000 previously exempt + present 15,000 13th = 95,000: 5,000 now taxable.
  // Combined taxable = 165,300 + 5,000 + 165,000 = 335,300.
  // Tax = (335,300 - 250,000) * 15% = 12,795.00.
  // Collection = 12,795 - 1,500 - 6,044.40 = 5,250.60.
  assert.equal(actual.annualization.exemptBenefitPool, 10_000);
  assert.equal(actual.annualization.taxableBenefitPool, 5_000);
  assert.equal(actual.taxDue, 12_795);
  assert.equal(actual.taxAdjustment, -5_250.60);
  assert.equal(actual.netFinalPay, 9_749.40);
  assert.equal(actual.thirteenthDue, 15_000, "another employer does not reduce this employer's 13th-month wage entitlement");
});

test("Explicitly verified no previous employer reproduces the single-employer result", () => {
  const noPrior: PriorEvidence = {
    ...verified,
    status: "none-confirmed", employerName: "", employerTin: "", periodFrom: "", periodTo: "",
    taxableIncome: "0.00", taxWithheld: "0.00", exemptBenefits: "0.00",
  };
  const normal = computeFinalPay(present);
  const declaredNone = computeFinalPay({ ...present, priorEmployerEvidence: { evidence: noPrior, taxYear: 2026 } });
  assert.equal(declaredNone.taxDue, 0);
  assert.equal(declaredNone.taxAdjustment, 6_044.40);
  assert.equal(declaredNone.netFinalPay, 21_044.40);
  assert.equal(declaredNone.taxAdjustment, normal.taxAdjustment);
  assert.equal(declaredNone.netFinalPay, normal.netFinalPay);
});

test("A previous-employer credit exceeding the annual tax requires review, never an automatic refund", () => {
  assert.throws(() => computeFinalPay({
    ...present,
    priorEmployerEvidence: { evidence: { ...verified, taxWithheld: "13000.00" }, taxYear: 2026 },
  }), /PRIOR_CREDITS_EXCEED_TAX_DUE_REVIEW_REQUIRED/);
});

test("Flag-OFF legacy calculation does not silently apply outside prior-employer figures", () => {
  const prior = process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
  try {
    delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    const baseline = computeFinalPay(present);
    assert.equal(baseline.taxDue, 0);
    assert.equal(baseline.taxAdjustment, 6_044.40);
    assert.equal(baseline.thirteenthDue, 15_000);
    assert.equal(baseline.netFinalPay, 21_044.40);
  } finally {
    if (prior === undefined) delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    else process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = prior;
  }
});

test("Separation route reads approved evidence and rechecks its digest during prepare, approve and release", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.match(route, /loadReviewedPriorForFinalPay\(/);
  assert.match(route, /priorEmployerEvidence: \{ evidence: priorEvidence\.evidence, taxYear: priorEvidenceScope\.taxYear \}/);
  assert.match(route, /priorEmployerEvidence: priorEvidenceSnapshot\(/);
  assert.ok((route.match(/assertFinalPayPriorSnapshot\(/g) ?? []).length >= 3,
    "initiation, approval and release each recheck the encrypted evidence digest under transaction");
});
