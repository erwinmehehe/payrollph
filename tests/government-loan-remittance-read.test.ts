import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedGovernmentLoanRemittanceRead } from "../src/lib/government-loan-remittance-read";

test("only complete employer-bound government loan evidence can be empty", () => {
  const empty = {
    organizationId: 4, legalEntityId: 18, today: "2026-10-20",
    legalEntity: {id:18, code: null, displayName:"Example Inc."},
    batches: [], members: [],
  };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(empty, 4), true);
  for (const invalid of [
    {...empty, organizationId: 5},
    {...empty, batches: undefined},
    {...empty, members: null},
    {...empty, legalEntity: {...empty.legalEntity, id:19}},
  ]) assert.equal(isVerifiedGovernmentLoanRemittanceRead(invalid, 4), false);
});
test("amounts and posting counts reconcile to source members", () => {
  const batch = {
    id:12, organizationId:4, legalEntityId:18,
    agency:"SSS", applicableMonth:"2026-09", dueDate:"2026-10-15",
    status:"open", displayStatus:"overdue", employeeCount:1, loanCount:1,
    expectedTotal:"125.00", amountPaid:null, pendingPostingCount:1, exceptionCount:0,
  };
  const member = {
    id:23, organizationId:4, legalEntityId:18, batchId:12, employeeId:3,
    employeeNo:"E3", loanType:"sss_salary", loanReferenceNo:"LOAN-1",
    deductedAmount:"125.00", postingStatus:"pending",
    postedAmount:null, postingReference:null, exceptionNote:null,
  };
  const valid = {organizationId:4,legalEntityId:18,today:"2026-10-20",
    legalEntity:{id:18,code:null,displayName:"Example Inc."},
    batches:[batch],members:[member]};
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(valid, 4), true);
  for (const invalid of [
    {...valid, batches:[{...batch,expectedTotal:"0.00"}]},
    {...valid, batches:[{...batch,pendingPostingCount:0}]},
    {...valid, batches:[{...batch,displayStatus:"paid"}]},
    {...valid, batches:[{...batch,loanCount:2}]},
    {...valid, members:[{...member,organizationId:9}]},
    {...valid, members:[]},
  ]) assert.equal(isVerifiedGovernmentLoanRemittanceRead(invalid, 4), false);
});
