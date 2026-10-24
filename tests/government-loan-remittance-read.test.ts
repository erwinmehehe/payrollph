import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGovernmentLoanRemittanceRead,
  isConfirmedGovernmentLoanMutation,
  isVerifiedGovernmentLoanRemittanceRead,
  type GovernmentLoanRead,
} from "../src/lib/government-loan-remittance-read";

const firstRevision = "2026-10-20T08:00:00.000Z";
const laterRevision = "2026-10-20T09:00:00.000Z";
const paidAt = "2026-10-20T08:55:00.000Z";
const baseBatch = {
  id: 12, organizationId: 4, legalEntityId: 18,
  agency: "SSS" as const, applicableMonth: "2026-09", dueDate: "2026-10-15",
  status: "open", displayStatus: "overdue", employeeCount: 1, loanCount: 1,
  expectedTotal: "125.00", amountPaid: null as string | null,
  paymentReference: null as string | null,
  agencyAcknowledgementReference: null as string | null,
  paymentVarianceNote: null as string | null,
  paidAt: null as string | null,
  pendingPostingCount: 1, exceptionCount: 0,
  updatedAt: firstRevision,
};
const baseMember = {
  id: 23, organizationId: 4, legalEntityId: 18,
  batchId: 12, employeeId: 3, employeeNo: "E3",
  loanType: "SSS Salary Loan", loanReferenceNo: "LOAN-1",
  deductedAmount: "125.00", postingStatus: "pending",
  postedAmount: null as string | null, postingReference: null as string | null,
  exceptionNote: null as string | null,
  updatedAt: firstRevision,
};
const baseRead: GovernmentLoanRead = {
  organizationId: 4, legalEntityId: 18, today: "2026-10-20",
  legalEntity: { id: 18, code: null, displayName: "Example Inc." },
  batches: [baseBatch], members: [baseMember],
};
const paidBatch = {
  ...baseBatch, status: "paid", displayStatus: "paid",
  amountPaid: "125.00", paymentReference: "PRN-12345",
  agencyAcknowledgementReference: "ACK-12345",
  paidAt, updatedAt: laterRevision,
};
const confirmedMember = {
  ...baseMember, postingStatus: "confirmed", postedAmount: "125.00",
  postingReference: "POST-12345", exceptionNote: null,
  updatedAt: laterRevision,
};
const exceptionMember = {
  ...baseMember, postingStatus: "exception",
  exceptionNote: "Agency posting was not found", updatedAt: laterRevision,
};

test("a complete employer-bound read is valid, while empty or foreign evidence must be explicit", () => {
  const empty = { ...baseRead, batches: [], members: [] };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(empty, 4), true);
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(baseRead, 4), true);
  for (const invalid of [
    { ...empty, organizationId: 5 },
    { ...empty, batches: undefined },
    { ...empty, members: null },
    { ...empty, legalEntity: { ...empty.legalEntity, id: 19 } },
    { ...baseRead, batches: [{ ...baseBatch, expectedTotal: "0.00" }] },
    { ...baseRead, batches: [{ ...baseBatch, loanCount: 0 }] },
    { ...baseRead, members: [{ ...baseMember, organizationId: 9 }] },
    { ...baseRead, members: [] },
  ]) assert.equal(isVerifiedGovernmentLoanRemittanceRead(invalid, 4), false);
});

test("member deduction amounts, posting counts and recorded money must reconcile", () => {
  for (const invalid of [
    { ...baseRead, batches: [{ ...baseBatch, expectedTotal: "126.00" }] },
    { ...baseRead, batches: [{ ...baseBatch, pendingPostingCount: 0 }] },
    { ...baseRead, batches: [{ ...baseBatch, displayStatus: "paid" }] },
    { ...baseRead, batches: [{ ...baseBatch, loanCount: 2 }] },
    { ...baseRead, members: [{ ...baseMember, deductedAmount: "125.001" }] },
    { ...baseRead, members: [{ ...baseMember, postingStatus: "confirmed", postedAmount: "0.00", postingReference: "POST-1" }] },
    { ...baseRead, members: [{ ...baseMember, postingStatus: "pending", postedAmount: "125.00" }] },
  ]) assert.equal(isVerifiedGovernmentLoanRemittanceRead(invalid, 4), false);
});

test("reconciled status demands real payment evidence and complete confirmed loan postings", () => {
  const settled: GovernmentLoanRead = {
    ...baseRead,
    batches: [{ ...paidBatch, status: "reconciled", displayStatus: "reconciled",
      pendingPostingCount: 0, exceptionCount: 0 }],
    members: [confirmedMember],
  };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(settled, 4), true);
  const impossible = [
    // Matching counts/totals used to let pending members masquerade as reconciled.
    { ...settled, batches: [{ ...settled.batches[0],
      pendingPostingCount: 1 }], members: [baseMember] },
    // A zero-paid reconciled batch used to pass the shape-only validator.
    { ...settled, batches: [{ ...settled.batches[0], amountPaid: null }] },
    { ...settled, batches: [{ ...settled.batches[0], amountPaid: "0.00" }] },
    { ...settled, batches: [{ ...settled.batches[0], paymentReference: null }] },
    { ...settled, batches: [{ ...settled.batches[0], agencyAcknowledgementReference: null }] },
    { ...settled, batches: [{ ...settled.batches[0], paidAt: null }] },
    { ...settled, members: [{ ...confirmedMember, postedAmount: "0.00" }] },
    { ...settled, members: [{ ...confirmedMember, postedAmount: "124.98" }] },
    { ...settled, members: [{ ...confirmedMember, postingReference: null }] },
  ];
  for (const invalid of impossible)
    assert.equal(isVerifiedGovernmentLoanRemittanceRead(invalid, 4), false);
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(
    { ...settled, members: [{ ...confirmedMember, postedAmount: "124.99" }] }, 4,
  ), true, "existing 1-cent posting tolerance is retained");
});

test("paid and exception status require employer payment and actual exception evidence", () => {
  const paid: GovernmentLoanRead = {
    ...baseRead, batches: [paidBatch],
  };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(paid, 4), true);
  const exception: GovernmentLoanRead = {
    ...baseRead,
    batches: [{ ...paidBatch, status: "exception", displayStatus: "exception",
      exceptionCount: 1, pendingPostingCount: 0 }],
    members: [exceptionMember],
  };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(exception, 4), true);
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(
    { ...exception, batches: [{ ...exception.batches[0], exceptionCount: 0 }] }, 4,
  ), false);
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(
    { ...exception, members: [{ ...exceptionMember, exceptionNote: null }] }, 4,
  ), false);
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(
    { ...paid, batches: [{ ...paidBatch, amountPaid: "125.02" }] }, 4,
  ), false, "excess remittance requires a reason");
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(
    { ...paid, batches: [{ ...paidBatch, amountPaid: "125.02", paymentVarianceNote: "Interest" }] }, 4,
  ), true);
});

test("new batch receipt must match the newly visible batch and employer", () => {
  const request = { agency: "SSS", applicableMonth: "2026-09" };
  assert.equal(isConfirmedGovernmentLoanMutation(
    "create_batch", request, { batch: { ...baseBatch } }, baseRead,
  ), true);
  assert.equal(isConfirmedGovernmentLoanMutation(
    "create_batch", request, { batch: { ...baseBatch, organizationId: 8 } }, baseRead,
  ), false);
  assert.equal(isConfirmedGovernmentLoanMutation(
    "create_batch", request, { batch: { ...baseBatch } },
    { ...baseRead, batches: [] },
  ), false);
  assert.equal(isConfirmedGovernmentLoanMutation(
    "create_batch", request, { batch: { ...baseBatch } },
    { ...baseRead, batches: [{ ...baseBatch, updatedAt: laterRevision }] },
  ), false);
});

test("payment POST plus stale but valid GET cannot produce a success confirmation", () => {
  const intent = {
    batchId: 12, amountPaid: 125,
    paymentReference: "PRN-12345",
    agencyAcknowledgementReference: "ACK-12345",
  };
  const receipt = { batch: { ...paidBatch } };
  const paid: GovernmentLoanRead = { ...baseRead, batches: [paidBatch] };
  assert.equal(isVerifiedGovernmentLoanRemittanceRead(paid, 4), true);
  assert.equal(isConfirmedGovernmentLoanMutation("record_payment", intent, receipt, paid), true);
  assert.equal(isConfirmedGovernmentLoanMutation("record_payment", intent, receipt, baseRead), false);
  assert.equal(isConfirmedGovernmentLoanMutation("record_payment", intent, receipt, {
    ...paid, batches: [{ ...paidBatch, updatedAt: firstRevision }],
  }), false);
  assert.equal(isConfirmedGovernmentLoanMutation("record_payment", intent, {
    batch: { ...paidBatch, paymentReference: "DIFFERENT-PRN" },
  }, paid), false);
  assert.equal(isConfirmedGovernmentLoanMutation("record_payment", intent, receipt, {
    ...paid, batches: [{ ...paidBatch, amountPaid: "125.01" }],
  }), false);
});

test("posting and exception POST receipts require fresh matching rows and revision", () => {
  const settled: GovernmentLoanRead = {
    ...baseRead, batches: [{ ...paidBatch, status: "reconciled", displayStatus: "reconciled",
      pendingPostingCount: 0, exceptionCount: 0 }],
    members: [confirmedMember],
  };
  const confirm = { memberId: 23, postedAmount: 125, postingReference: "POST-12345" };
  const receipt = { member: { ...confirmedMember } };
  assert.equal(isConfirmedGovernmentLoanMutation("confirm_member_posting", confirm, receipt, settled), true);
  assert.equal(isConfirmedGovernmentLoanMutation("confirm_member_posting", confirm, receipt,
    { ...settled, members: [baseMember] }), false);
  assert.equal(isConfirmedGovernmentLoanMutation("confirm_member_posting", confirm, receipt,
    { ...settled, members: [{ ...confirmedMember, updatedAt: firstRevision }] }), false);

  const except: GovernmentLoanRead = {
    ...baseRead,
    batches: [{ ...paidBatch, status: "exception", displayStatus: "exception",
      pendingPostingCount: 0, exceptionCount: 1 }],
    members: [exceptionMember],
  };
  const intent = { memberId: 23, exceptionNote: "Agency posting was not found" };
  assert.equal(isConfirmedGovernmentLoanMutation("mark_member_exception", intent,
    { member: { ...exceptionMember } }, except), true);
  assert.equal(isConfirmedGovernmentLoanMutation("mark_member_exception", intent,
    { member: { ...exceptionMember } },
    { ...except, batches: [{ ...paidBatch }] }), false);
  assert.equal(isConfirmedGovernmentLoanMutation("mark_member_exception", intent,
    { member: { ...exceptionMember } },
    { ...except, members: [{ ...exceptionMember, updatedAt: firstRevision }] }), false);
});

test("legacy loan reads reject non-OK, missing arrays and foreign envelopes before state", () => {
  assert.equal(parseGovernmentLoanRemittanceRead(true, baseRead, 4), baseRead);
  const empty = {...baseRead, batches: [], members: []};
  assert.equal(parseGovernmentLoanRemittanceRead(true, empty, 4), empty);
  assert.equal(parseGovernmentLoanRemittanceRead(false, baseRead, 4), null);
  for (const bad of [null, {}, [], {...empty, organizationId: 5}, {...empty, members: undefined},
    {...baseRead, batches: [{...baseBatch, expectedTotal: null}]}]) {
    assert.equal(parseGovernmentLoanRemittanceRead(true, bad, 4), null);
  }
});
