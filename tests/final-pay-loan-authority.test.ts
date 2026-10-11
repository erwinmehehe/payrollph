import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { finalPayLoanReviewSummary, finalPayReviewCsv } from "../src/lib/final-pay-review-evidence";
import {
  matchesRecordedFinalPayLoanReview,
  reviewFinalPayLoans,
  type FinalPayLoanEvidence,
} from "../src/lib/final-pay-loan-authority";

const valid = (id: number, balance: string): FinalPayLoanEvidence => ({
  id,
  loanType: "Company Emergency Loan",
  status: "active",
  remainingBalance: balance,
  requestedByUserId: 111,
  reviewedByUserId: 222,
  reviewedAt: new Date("2026-10-01T06:00:00Z"),
  deductionAuthorizationReference: "SIGNED-DOCUMENT-EMPLOYEE-7",
  reviewEvidenceReference: "HR-CHECKER-APPROVAL-1729",
});

test("only independently reviewed, documented active loans are considered deductible", () => {
  const eligible = valid(1, "1200.50");
  const missingAuthority = { ...valid(2, "320.25"), deductionAuthorizationReference: null };
  const selfReviewed = { ...valid(3, "50.00"), reviewedByUserId: 111 };
  const missingReviewDate = { ...valid(4, "60.00"), reviewedAt: null };
  const closed = { ...valid(5, "500.00"), status: "paid_off" };
  const review = reviewFinalPayLoans([closed, missingAuthority, eligible, selfReviewed, missingReviewDate]);

  assert.deepEqual(review.eligibleLoanIds, [1]);
  assert.equal(review.eligibleBalance, 1200.50);
  assert.equal(review.unrecoveredBalance, 430.25);
  assert.deepEqual(review.unrecoveredLoans.map(l => [l.id, l.balance, l.reason]), [
    [2, 320.25, "MISSING_INDEPENDENT_SIGNED_AUTHORITY_EVIDENCE"],
    [3, 50, "MISSING_INDEPENDENT_SIGNED_AUTHORITY_EVIDENCE"],
    [4, 60, "MISSING_INDEPENDENT_SIGNED_AUTHORITY_EVIDENCE"],
  ]);
  assert.deepEqual(review.invalidLoanIds, []);
  assert.deepEqual(review, reviewFinalPayLoans([eligible, selfReviewed, missingReviewDate, missingAuthority, closed]));
  assert.doesNotMatch(JSON.stringify(review), /SIGNED-DOCUMENT-EMPLOYEE-7|HR-CHECKER-APPROVAL-1729/);
});

test("legacy active loans without stable identity or evidence remain unrecovered", () => {
  const missingRequestor = { ...valid(9, "300.00"), requestedByUserId: null };
  const placeholders = { ...valid(10, "400.00"), deductionAuthorizationReference: "not applicable" };
  const review = reviewFinalPayLoans([missingRequestor, placeholders]);
  assert.deepEqual(review.eligibleLoanIds, []);
  assert.equal(review.eligibleBalance, 0);
  assert.equal(review.unrecoveredBalance, 700);
});

test("invalid loan cents fail closed rather than silently zeroing the debt", () => {
  const review = reviewFinalPayLoans([
    valid(1, "100.00"),
    valid(2, "2.001"),
    valid(3, "-5.00"),
    valid(4, "NaN"),
  ]);
  assert.deepEqual(review.invalidLoanIds, [2, 3, 4]);
  assert.equal(review.eligibleBalance, 100);
  assert.equal(matchesRecordedFinalPayLoanReview(review, review), false);
});

test("revoked or rewritten signed-authority evidence invalidates the frozen snapshot", () => {
  const old = reviewFinalPayLoans([valid(1, "70.50")]);
  assert.equal(matchesRecordedFinalPayLoanReview(old, old), true);
  assert.equal(matchesRecordedFinalPayLoanReview(undefined, old), false);
  assert.equal(matchesRecordedFinalPayLoanReview({}, old), false);
  const replaced = reviewFinalPayLoans([{ ...valid(1, "70.50"), reviewEvidenceReference: "CHANGED-HR-REVIEW-17" }]);
  assert.equal(matchesRecordedFinalPayLoanReview(old, replaced), false);
  assert.equal(matchesRecordedFinalPayLoanReview(
    { ...old, unrecoveredBalance: 1 }, old,
  ), false, "snapshot amount tampering must invalidate approval");
  assert.equal(matchesRecordedFinalPayLoanReview(old, reviewFinalPayLoans([
    { ...valid(1, "70.50"), deductionAuthorizationReference: null },
  ])), false);
});

test("separation creation and locked release use the same signed-authority eligibility", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const fingerprint = readFileSync("src/lib/final-pay-source-fingerprint.ts", "utf8");
  assert.match(route, /const loanDeductions = deductOutstandingLoans \? loanAuthority\.eligibleBalance : 0/);
  assert.match(route, /loanAuthority,/);
  assert.ok((route.match(/matchesRecordedFinalPayLoanReview\(/g) ?? []).length >= 3);
  assert.match(route, /\.filter\(\(loan\) => eligibleLoanIds\.has\(loan\.id\)\)/);
  assert.match(route, /eq\(employeeLoans\.deductionAuthorizationReference, loan\.deductionAuthorizationReference!\)/);
  assert.match(fingerprint, /loanAuthorityEvidenceDigest: reviewFinalPayLoans\(sources\.loans\)\.evidenceDigest/);
});

test("finance preview and CSV list unrecovered loans without raw signed evidence references", () => {
  const loanReview = reviewFinalPayLoans([
    valid(1, "800.00"),
    { ...valid(2, "350.75"), deductionAuthorizationReference: null },
  ]);
  const record = {
    id: 10,
    employeeNo: "EMP-10",
    employeeName: "Employee Example",
    grossFinalPay: "5000.00",
    netFinalPay: "4200.00",
    taxAdjustment: "0.00",
    finalStatutoryDeductions: "0.00",
    loanDeductions: "800.00",
    computationSnapshot: { loanAuthority: loanReview, deductOutstandingLoans: true },
  };
  const display = finalPayLoanReviewSummary(record);
  assert.equal(display.recorded, true);
  assert.equal(display.unrecoveredBalance, 350.75);
  assert.deepEqual(display.unrecovered.map(x => x.id), [2]);
  const csv = finalPayReviewCsv(record);
  assert.match(csv, /Outstanding loans excluded pending authority review/);
  assert.match(csv, /Unrecovered loan #2/);
  assert.match(csv, /350\.75/);
  assert.match(csv, /not independent proof of employee signature/i);
  assert.doesNotMatch(csv, /SIGNED-DOCUMENT-EMPLOYEE-7|HR-CHECKER-APPROVAL-1729/);
  assert.equal(finalPayLoanReviewSummary({ ...record, computationSnapshot: {} }).recorded, false);
});

test("active loan placeholders never constitute documented independent authority", () => {
  for (const authorityRef of ["not applicable", "N/A", "pending approval", "test deduction", "unknown", "None"]) {
    const loans = reviewFinalPayLoans([{ ...valid(70, "42.50"), deductionAuthorizationReference: authorityRef }]);
    assert.equal(loans.eligibleBalance, 0, authorityRef);
    assert.equal(loans.unrecoveredBalance, 42.50);
  }
});
