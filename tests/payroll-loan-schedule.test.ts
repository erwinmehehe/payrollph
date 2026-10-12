import test from "node:test";
import assert from "node:assert/strict";
import { reviewFinalPayLoans } from "../src/lib/final-pay-loan-authority";
import {
  buildCompanyLoanSchedule, validateAgencyAmortizationSchedule, previewDiscretionaryLoanDeduction,
} from "../src/lib/payroll-loan-schedule";

test("company installments are centavo exact and the final repayment reaches zero", () => {
  for (const [principal, months, rate] of [["1000.01", 3, 0], ["15555.31", 12, 1000], ["0.01", 2, 0]] as const) {
    const run = buildCompanyLoanSchedule({ principal, months, annualFlatInterestBasisPoints: rate, installmentsPerMonth: 2 });
    assert.equal(run.installments.length, months * 2);
    assert.equal(run.installments.reduce((sum, x) => sum + x.principalCents, 0), run.totalPrincipalCents);
    assert.equal(run.installments.reduce((sum, x) => sum + x.interestCents, 0), run.totalInterestCents);
    assert.equal(run.installments.reduce((sum, x) => sum + x.dueCents, 0), run.totalPayableCents);
    assert.equal(run.installments.at(-1)?.remainingPrincipalCents, 0);
    assert.equal(run.installments.at(-1)?.remainingPayableCents, 0);
    assert.ok(run.installments.every(x => x.remainingPayableCents >= 0));
  }
});
test("invalid interest, amounts and terms fail closed", () => {
  for (const x of ["-1", "1.001", "1e5", "0", "123abc"]) {
    assert.throws(() => buildCompanyLoanSchedule({ principal: x, months: 12, installmentsPerMonth: 2, annualFlatInterestBasisPoints: 0 }));
  }
  assert.throws(() => buildCompanyLoanSchedule({ principal: "100.00", months: 0, installmentsPerMonth: 2, annualFlatInterestBasisPoints: 0 }));
  assert.throws(() => buildCompanyLoanSchedule({ principal: "100.00", months: 12, installmentsPerMonth: 2, annualFlatInterestBasisPoints: 10_001 }));
});
test("SSS and Pag-IBIG import validation refuses duplicates and mutated agency amounts", () => {
  const rows = [
    { dueDate: "2026-11-15", amount: "450.01", sourceRowId: "AGENCY-001" },
    { dueDate: "2026-12-15", amount: "450.00", sourceRowId: "AGENCY-002" },
  ];
  for (const agency of ["SSS", "Pag-IBIG"] as const) {
    const out = validateAgencyAmortizationSchedule(rows, agency, "REF-1234");
    assert.equal(out.scheduledTotalCents, 90001);
    assert.equal(out.rows[0].cents, 45001);
  }
  assert.throws(() => validateAgencyAmortizationSchedule([...rows, rows[1]], "SSS", "REF-1234"));
  assert.throws(() => validateAgencyAmortizationSchedule([{ ...rows[0], amount: "450.001" }], "SSS", "REF-1234"));
  assert.throws(() => validateAgencyAmortizationSchedule([...rows].reverse(), "SSS", "REF-1234"));
});
test("floor defers deductions, caps to loan balance and independent approved override is explicit", () => {
  const base = { disposablePayCents: 250000, minimumNetPayCents: 180000, remainingLoanCents: 400000, requestedCents: 100000 };
  assert.deepEqual(previewDiscretionaryLoanDeduction(base),
    { deductedCents: 70000, deferredCents: 30000, netAfterCents: 180000, overrideUsed: false });
  assert.equal(previewDiscretionaryLoanDeduction({ ...base, remainingLoanCents: 1 }).deductedCents, 1);
  assert.throws(() => previewDiscretionaryLoanDeduction({ ...base, override: {
    requesterUserId: 1, approverUserId: 1, legalAuthorityReviewed: true,
    reason: "Specific reviewed employee written authorization", approvalEvidenceReference: "REVIEW-1234" } }), /NOT_APPROVED/);
  assert.deepEqual(previewDiscretionaryLoanDeduction({ ...base, override: {
    requesterUserId: 1, approverUserId: 2, legalAuthorityReviewed: true,
    reason: "Specific reviewed employee written authorization", approvalEvidenceReference: "REVIEW-1234" } }),
    { deductedCents: 100000, deferredCents: 0, netAfterCents: 150000, overrideUsed: true });
  assert.equal(previewDiscretionaryLoanDeduction({ ...base, disposablePayCents: 0 }).deductedCents, 0);
});

test("early resignation carries the outstanding balance to existing reviewed final-pay authority", () => {
  const schedule = buildCompanyLoanSchedule({ principal: "1025.03", months: 3,
    annualFlatInterestBasisPoints: 0, installmentsPerMonth: 2 });
  const afterTwo = schedule.installments[1].remainingPrincipalCents;
  const outstanding = (afterTwo / 100).toFixed(2);
  const pending = reviewFinalPayLoans([{
    id: 55, loanType: "Company Emergency Loan", status: "active",
    remainingBalance: outstanding, requestedByUserId: 10,
    deductionAuthorizationReference: "signed-contract-55",
  }]);
  assert.deepEqual(pending.eligibleLoanIds, []);
  assert.equal(pending.unrecoveredBalance, afterTwo / 100);
  const reviewed = reviewFinalPayLoans([{
    id: 55, loanType: "Company Emergency Loan", status: "active",
    remainingBalance: outstanding, requestedByUserId: 10, reviewedByUserId: 11,
    reviewedAt: "2026-10-12T00:00:00.000Z",
    deductionAuthorizationReference: "signed-contract-55",
    reviewEvidenceReference: "independent-checker-55",
  }]);
  assert.deepEqual(reviewed.eligibleLoanIds, [55]);
  assert.equal(reviewed.eligibleBalance, afterTwo / 100);
  assert.equal(reviewed.unrecoveredBalance, 0);
  assert.equal(schedule.installments.at(-1)?.remainingPrincipalCents, 0);
});
