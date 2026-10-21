import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedGovernmentLoanRead, readVerifiedGovernmentLoanRemittances,
  type VerifiedGovernmentLoanRead,
} from "@/lib/government-loan-remittance-read";

const org = 101;
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
  amountPaid: null, pendingPostingCount: 1, exceptionCount: 0,
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("government loan: verified zero batch/member lists are legitimate only with correct employer", async () => {
  assert.equal(isVerifiedGovernmentLoanRead(empty, org), true);
  assert.deepEqual(await readVerifiedGovernmentLoanRemittances(org, json(empty)), empty);
  assert.equal(isVerifiedGovernmentLoanRead({ ...empty, batches: [batch], members: [member] }, org), true);
});

test("government loan: HTTP non-OK and invalid JSON always unavailable", async () => {
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, json(empty, 500)), /unavailable/);
  const malformed = (async () => new Response("{", { status: 200 })) as typeof fetch;
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, malformed), /malformed JSON/);
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
  ]) {
    assert.equal(isVerifiedGovernmentLoanRead(value, org), false);
    await assert.rejects(readVerifiedGovernmentLoanRemittances(org, json(value)), /incomplete or for another/);
  }
});

test("government loan: explicit retry refetches after failure, never caches synthetic empty", async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    return attempts === 1 ? new Response("{not json") : new Response(JSON.stringify(empty));
  }) as typeof fetch;
  await assert.rejects(readVerifiedGovernmentLoanRemittances(org, fetcher));
  assert.deepEqual(await readVerifiedGovernmentLoanRemittances(org, fetcher), empty);
  assert.equal(attempts, 2);
});
