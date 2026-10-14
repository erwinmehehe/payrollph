import assert from "node:assert/strict";
import test from "node:test";
import { approvedReimbursementAmount, reimbursementEligible, reimbursementSettlementDecision, reimbursementLineTaxMatches, receiptObjectIdentityMatches } from "../src/lib/spend-payroll-reimbursement";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
const claim = { status: "approved", payrollRunId: null, amount: "500.00", approvedAmount: "450.01",
  categoryPolicyId: 8, receiptStorageKey: "private-documents/1/2/00000000-0000-4000-8000-000000000001",
  receiptSha256: "a".repeat(64) };
Object.assign(claim, { organizationId: 1, employeeId: 2, submittedByUserId: 1, approvedByUserId: 2,
  approvedAt: new Date(), policyMatched: true, receiptByteSize: 8, receiptVerifiedAt: new Date() });
test("spend to payroll stays off until explicitly enabled", () => {
  assert.equal(criticalReleaseFlagEnabled("spendPayroll", {}), false);
  assert.equal(criticalReleaseFlagEnabled("spendPayroll", { SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("spendPayroll", { SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true" }), true);
});
test("centavo exact approved amount cannot exceed claim or become zero", () => {
  assert.equal(approvedReimbursementAmount("450.01", "500.00"), "450.01");
  assert.equal(approvedReimbursementAmount("500.01", "500.00"), null);
  assert.equal(approvedReimbursementAmount("0", "500.00"), null);
  assert.equal(approvedReimbursementAmount("0.001", "500.00"), null);
  assert.equal(approvedReimbursementAmount("10000000000.00", "10000000000.00"), null);
});

test("review evidence rejects unknown/self makers, wrong worker and unverified bytes", () => {
  for (const changes of [{ submittedByUserId: null }, { submittedByUserId: 2 },
    { approvedByUserId: null }, { policyMatched: false }, { employeeId: 3 },
    { receiptVerifiedAt: null }, { receiptByteSize: 5242881 }, { approvedAt: new Date(NaN) },
    { approvedAmount: "500.01" }]) assert.equal(reimbursementEligible({ ...claim, ...changes }, true), false);
});
test("reimbursement is independently reviewed and can settle only once", () => {
  assert.equal(reimbursementEligible(claim, true), true);
  assert.equal(reimbursementSettlementDecision(claim, 10, "450.01", true), "settle");
  assert.equal(reimbursementSettlementDecision({...claim, status: "paid", payrollRunId: 10 }, 10, "450.01", true), "already_settled");
  assert.equal(reimbursementSettlementDecision({...claim, status: "paid", payrollRunId: 11 }, 10, "450.01", true), "paid_elsewhere");
  assert.equal(reimbursementSettlementDecision({...claim, receiptStorageKey: null}, 10, "450.01", true), "missing_evidence");
  assert.equal(reimbursementSettlementDecision(claim, 10, "500.00", true), "amount_changed");
});

test("payslip tax marker cannot drift after a category policy changes", () => {

  assert.equal(reimbursementLineTaxMatches(true, ["Taxi fare", "Taxable reimbursement"]), true);
  assert.equal(reimbursementLineTaxMatches(false, ["Taxi fare", "Non-taxable reimbursement"]), true);
  assert.equal(reimbursementLineTaxMatches(true, ["Non-taxable reimbursement"]), false);
  assert.equal(reimbursementLineTaxMatches(false, []), false);
  assert.equal(reimbursementLineTaxMatches(true, ["Taxable reimbursement", "Non-taxable reimbursement"]), false);
});

test("receipt signed URLs require exact claim tenant and employee object prefix",()=>{
 const key="private-documents/44/90/00000000-0000-4000-8000-000000000001";
 assert.equal(receiptObjectIdentityMatches(key,44,90),true);
 assert.equal(receiptObjectIdentityMatches(key,45,90),false);
 assert.equal(receiptObjectIdentityMatches(key,44,91),false);
 for(const bad of ["private-documents/44/90/../../45/91/00000000-0000-4000-8000-000000000001",
  "private-documents/44/90/00000000-0000-0000-0000-000000000001",
  "private-documents/44/company/00000000-0000-4000-8000-000000000001",
 ])assert.equal(receiptObjectIdentityMatches(bad,44,90),false,bad);
});
