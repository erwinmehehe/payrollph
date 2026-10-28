import test from "node:test";
import assert from "node:assert/strict";
import { reviewFinalPayLoans } from "../src/lib/final-pay-loan-authority";
import {
  buildCompanyLoanSchedule, validateAgencyAmortizationSchedule, previewDiscretionaryLoanDeduction,
} from "../src/lib/payroll-loan-schedule";

test("company schedule refuses coercible booleans, nulls, arrays and numeric strings", () => {
  const valid = { principal: "1000.00", months: 1, installmentsPerMonth: 1 as const, annualFlatInterestBasisPoints: 0 };
  for (const field of ["months", "installmentsPerMonth", "annualFlatInterestBasisPoints"] as const) {
    for (const value of [true, false, null, [], "1", ""]) {
      assert.throws(() => buildCompanyLoanSchedule({ ...valid, [field]: value } as unknown as Parameters<typeof buildCompanyLoanSchedule>[0]),
        /INVALID_LOAN_SCHEDULE/);
    }
  }
});

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

test("A-1 company preview refuses coercible non-string principals", () => {
  const valid = { principal: "1000.00", months: 2, installmentsPerMonth: 2 as const, annualFlatInterestBasisPoints: 500 };
  for (const principal of [1000, true, { toString: () => "1000.00" }, null]) {
    assert.throws(() => buildCompanyLoanSchedule({
      ...valid, principal,
    } as unknown as Parameters<typeof buildCompanyLoanSchedule>[0]), /INVALID_LOAN_SCHEDULE/);
  }
  assert.equal(buildCompanyLoanSchedule(valid).totalPrincipalCents, 100000);
});

test("A-1 agency import rejects forged non-string reference and installment fields", () => {
  const row = { dueDate: "2026-11-15", amount: "125.00", sourceRowId: "AGENCY-1001" };
  const invalidRows = [
    [{ ...row, amount: 125 }],
    [{ ...row, amount: { toString: () => "125.00" } }],
    [{ ...row, sourceRowId: 12345 }],
    [{ ...row, dueDate: null }],
    [null],
  ];
  for (const rows of invalidRows) {
    assert.throws(() => validateAgencyAmortizationSchedule(
      rows as unknown as Parameters<typeof validateAgencyAmortizationSchedule>[0],
      "SSS", "REF-1234",
    ), /INVALID_AGENCY_LOAN_INSTALLMENT/);
  }
  assert.throws(() => validateAgencyAmortizationSchedule(
    [row], "SSS", 12345 as unknown as string,
  ), /INVALID_AGENCY_LOAN_SCHEDULE/);
  assert.throws(() => validateAgencyAmortizationSchedule(
    { length: 1, map: () => [row] } as unknown as Parameters<typeof validateAgencyAmortizationSchedule>[0],
    "SSS", "REF-1234",
  ), /INVALID_AGENCY_LOAN_SCHEDULE/);
  assert.equal(validateAgencyAmortizationSchedule([row], "SSS", "REF-1234").scheduledTotalCents, 12500);
});

test("A-1 floor preview denies blank or malformed approval evidence", () => {
  const valid = {
    disposablePayCents: 250000, minimumNetPayCents: 180000,
    remainingLoanCents: 400000, requestedCents: 100000,
    override: {
      requesterUserId: 10, approverUserId: 11, legalAuthorityReviewed: true,
      approvalEvidenceReference: "REVIEW-1234",
      reason: "Documented separate legal and payroll approval",
    },
  };
  for (const invalidOverride of [
    { ...valid.override, approvalEvidenceReference: "          " },
    { ...valid.override, approvalEvidenceReference: "REVIEW-1234" + String.fromCharCode(10) + "FORGED" },
    { ...valid.override, reason: 12345 },
    { ...valid.override, reason: "Documented separate" + String.fromCharCode(9) + "legal and payroll approval" },
  ]) {
    assert.throws(() => previewDiscretionaryLoanDeduction({
      ...valid, override: invalidOverride,
    } as unknown as Parameters<typeof previewDiscretionaryLoanDeduction>[0]), /LOAN_FLOOR_OVERRIDE_NOT_APPROVED/);
  }
  assert.equal(previewDiscretionaryLoanDeduction(valid).overrideUsed, true);
});
