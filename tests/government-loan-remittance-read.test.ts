import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedGovernmentLoanMutation,
  isVerifiedGovernmentLoanRead, readVerifiedGovernmentLoanRemittances,
  type VerifiedGovernmentLoanRead,
} from "@/lib/government-loan-remittance-read";

const org = 101, entity = 12;
const empty: VerifiedGovernmentLoanRead = {
  organizationId: org, today: "2026-10-21",
  legalEntity: { id: 12, code: "FICTIONAL", displayName: "Fictional Employer" },
  batches: [], members: [],
};
const member = {
  id: 88, batchId: 33, organizationId: org, legalEntityId: 12,
  employeeNo: "FICTIONAL-001", loanType: "SSS salary",
  loanReferenceNo: "FICTIONAL-LOAN", deductedAmount: "100.00",
  postingStatus: "pending" as const, postedAmount: null,
  postingReference: null, exceptionNote: null,
};
const batch = {
  id: 33, organizationId: org, legalEntityId: 12,
  agency: "SSS" as const, applicableMonth: "2026-09", dueDate: "2026-10-31",
  status: "open" as const, displayStatus: "open" as const,
  employeeCount: 1, loanCount: 1, expectedTotal: "100.00",
  amountPaid: null, paymentReference: null, agencyAcknowledgementReference: null,
  pendingPostingCount: 1, exceptionCount: 0,
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("government loan: verified zero batch/member lists are legitimate only with correct employer", async () => {
  assert.equal(isVerifiedGovernmentLoanRead(empty, org, entity), true);
  assert.deepEqual(await readVerifiedGovernmentLoanRemittances(org, entity, json(empty)), empty);
  assert.equal(isVerifiedGovernmentLoanRead({ ...empty, batches: [batch], members: [member] }, org, entity), true);
});

test("government loan: HTTP non-OK and invalid JSON always unavailable", async () => {
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, entity, json(empty, 500)), /unavailable/);
  const malformed = (async () => new Response("{", { status: 200 })) as typeof fetch;
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, entity, malformed), /malformed JSON/);
});

test("government loan: missing counts, arrays, foreign employer/LE or partial members rejected", async () => {
  for (const value of [
    {}, { ...empty, organizationId: org + 1 },
    { ...empty, batches: undefined }, { ...empty, members: undefined },
    { ...empty, legalEntity: { id: 12, code: "" } },
    { ...empty, batches: [batch], members: [] },
    { ...empty, batches: [batch], members: [{ ...member, organizationId: org + 1 }] },
    { ...empty, batches: [batch], members: [{ ...member, legalEntityId: 23 }] },
    { ...empty, batches: [{ ...batch, pendingPostingCount: 0 }], members: [member] },
    { ...empty, batches: [{ ...batch, expectedTotal: undefined }], members: [member] },
    { ...empty, batches: [{ ...batch, organizationId: org + 1 }], members: [member] },
    { ...empty, batches: [{ ...batch, loanCount: 2 }], members: [member] },
    { ...empty, batches: [{ ...batch, expectedTotal: "0.00" }], members: [member] },
    { ...empty, batches: [{ ...batch, expectedTotal: "100.01" }], members: [member] },
    { ...empty, batches: [{ ...batch, employeeCount: 2 }], members: [member] },
  ]) {
    assert.equal(isVerifiedGovernmentLoanRead(value, org, entity), false);
    await assert.rejects(readVerifiedGovernmentLoanRemittances(org, entity, json(value)), /incomplete or for another/);
  }
});

test("government loan: multiple loans sum exactly in cents and count distinct employees", () => {
  const member2 = { ...member, id: 89, loanType: "SSS calamity",
    loanReferenceNo: "FICTIONAL-LOAN-2", deductedAmount: "0.01" };
  const b2 = { ...batch, loanCount: 2, employeeCount: 1, expectedTotal: "100.01", pendingPostingCount: 2 };
  const verified = { ...empty, batches: [b2], members: [member, member2] };
  assert.equal(isVerifiedGovernmentLoanRead(verified, org, entity), true);
  assert.equal(isVerifiedGovernmentLoanRead({ ...verified,
    batches: [{ ...b2, expectedTotal: "100.00" }] }, org, entity), false);
  assert.equal(isVerifiedGovernmentLoanRead(verified, org, entity + 1), false);
});
test("government loan: explicit retry refetches after failure, never caches synthetic empty", async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    return attempts === 1 ? new Response("{not json") : new Response(JSON.stringify(empty));
  }) as typeof fetch;
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, entity, fetcher));
  assert.deepEqual(await readVerifiedGovernmentLoanRemittances(org, entity, fetcher), empty);
  assert.equal(attempts, 2);
});

test("government loan: a schema-valid stale GET must never confirm a POST receipt", () => {
  const before = { ...empty, batches: [batch], members: [member] };
  const created = { batch: { ...batch, id: 33 } };
  assert.equal(confirmedGovernmentLoanMutation("create_batch", created, before, org, entity), true);
  assert.equal(confirmedGovernmentLoanMutation("create_batch", created, empty, org, entity), false);
  const paid = { ...batch, status: "paid" as const, displayStatus: "paid" as const,
    amountPaid: "100.00", paymentReference: "FICTIONAL-PAY-ABC",
    agencyAcknowledgementReference: "FICTIONAL-ACK-DEF" };
  const paidReceipt = { batch: paid };
  assert.equal(confirmedGovernmentLoanMutation("record_payment", paidReceipt,
    { ...empty, batches: [paid], members: [member] }, org, entity), true);
  assert.equal(confirmedGovernmentLoanMutation("record_payment", paidReceipt,
    before, org, entity), false);
  const confirmed = { ...member, postingStatus: "confirmed" as const,
    postedAmount: "100.00", postingReference: "FICTIONAL-POSTING" };
  const confirmedBatch = { ...paid, pendingPostingCount: 0 };
  assert.equal(confirmedGovernmentLoanMutation("confirm_member_posting", { member: confirmed },
    { ...empty, batches: [confirmedBatch], members: [confirmed] }, org, entity), true);
  assert.equal(confirmedGovernmentLoanMutation("confirm_member_posting", { member: confirmed },
    { ...empty, batches: [confirmedBatch], members: [member] }, org, entity), false);
  assert.equal(confirmedGovernmentLoanMutation("record_payment", paidReceipt,
    { ...empty, organizationId: org + 1, batches: [paid], members: [member] }, org, entity), false);
});
