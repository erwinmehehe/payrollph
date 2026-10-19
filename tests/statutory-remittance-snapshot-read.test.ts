import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readVerifiedRemittanceSnapshot, isVerifiedRemittanceSnapshot } from "../src/lib/statutory-remittance-snapshot-read";

const empty = () => ({
  organizationId: 14, today: "2026-10-19",
  legalEntity: { id: 77, code: "MAIN", displayName: "Fictional Test Employer" }, batches: [],
  members: [], coverageGaps: [], alerts: [],
});
const batch = () => ({
  id: 4, organizationId: 14, legalEntityId: 77, agency: "SSS",
  applicableMonth: "2026-09", dueDate: "2026-10-10", status: "open", displayStatus: "open",
  employeeCount: 1, expectedEmployeeShare: "100.00", expectedEmployerShare: "120.00",
  expectedTotal: "220.00", amountPaid: null, paymentReference: null,
  agencyReceiptReference: null, paidAt: null, pendingPostingCount: 1, exceptionCount: 0,
  paymentShortfall: 220, hasActivePaymentProof: false,
  filingCheck: { status: "unverified", filingRecordId: null,
    filingEmployeeCount: null, remittanceEmployeeCount: 1,
    filingTotal: null, remittanceTotal: 220,
    employeeCountDifference: null, totalDifference: null },
});
const snapshot = () => ({ ...empty(), batches: [batch()] });
const fake = (r: Response): typeof fetch => (async () => r) as typeof fetch;
test("verified empty remittance is valid, and populated payment liability remains valid", async () => {
  assert.equal(isVerifiedRemittanceSnapshot(snapshot(), 14, 77), true);
  assert.deepEqual((await readVerifiedRemittanceSnapshot(14, 77, fake(Response.json(empty())))).batches, []);
});
test("non-OK, malformed JSON, missing fields, foreign employer and invalid monetary rows fail closed", async () => {
  for (const response of [
    new Response("denied",{status:403}), new Response("invalid-json",{status:200}),
    Response.json({ ...empty(), batches: undefined }),
    Response.json({ ...empty(), alerts: undefined }),
    Response.json({ ...empty(), organizationId: 15 }),
    Response.json({ ...empty(), legalEntity: { id: 79 } }),
    Response.json({ ...snapshot(), batches: [{...batch(), expectedTotal: undefined}] }),
    Response.json({ ...snapshot(), batches: [{...batch(), organizationId: 15}] }),
    Response.json({ ...snapshot(), members: [{ id: 8, batchId: 666 }] }),
    Response.json({ ...snapshot(), batches: [{...batch(), filingCheck: undefined}] }),
    Response.json({ ...snapshot(), batches: [{...batch(), hasActivePaymentProof: undefined}] }),
    Response.json({ ...snapshot(), batches: [{...batch(), paymentShortfall: undefined}] }),
    Response.json({ ...empty(), today: undefined }),
    Response.json({ ...empty(), legalEntity: {id:77} }),
    Response.json({ ...snapshot(), batches: [{...batch(), applicableMonth: "2026-19"}] }),
    Response.json({ ...snapshot(), batches: [{...batch(), dueDate: "2026-02-31"}] }),
  ]) await assert.rejects(() => readVerifiedRemittanceSnapshot(14, 77, fake(response)));
});
test("accepted filing cannot masquerade as matched with missing financial evidence", () => {
  const matched = { ...batch(), filingCheck: {
    status: "matched", filingRecordId: 9, filingEmployeeCount: 1,
    remittanceEmployeeCount: 1, filingTotal: 220, remittanceTotal: 220,
    employeeCountDifference: 0, totalDifference: 0,
  } };
  assert.equal(isVerifiedRemittanceSnapshot({ ...empty(), batches: [matched] }, 14, 77), true);
  for (const field of ["filingRecordId", "filingEmployeeCount", "filingTotal", "employeeCountDifference", "totalDifference"] as const) {
    const filingCheck = { ...matched.filingCheck, [field]: null };
    assert.equal(isVerifiedRemittanceSnapshot({ ...empty(), batches: [{ ...matched, filingCheck }] }, 14, 77), false, field);
  }
  assert.equal(isVerifiedRemittanceSnapshot({
    ...empty(), batches: [{ ...matched, filingCheck: { ...matched.filingCheck, status: "mismatch", filingTotal: null } }],
  }, 14, 77), false);
});
test("explicit retry permits a truly empty but verified remittance list", async () => {
  let tries=0;
  const fetcher=(async () => {
    tries++;
    return tries===1?new Response("offline",{status:503}):Response.json(empty());
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedRemittanceSnapshot(14,77,fetcher));
  assert.deepEqual((await readVerifiedRemittanceSnapshot(14,77,fetcher)).batches,[]);
  assert.equal(tries,2);
});
test("component blocks payment/posting actions when read is unavailable", () => {
  const code=readFileSync("src/components/workspace/statutory-remittance-panel.tsx","utf8");
  assert.match(code,/readVerifiedRemittanceSnapshot\(\s*organizationId, legalEntityId \?\? null, fetch, controller\.signal,?\s*\)/);
  assert.match(code,/if \(loadError\) return \(/);
  assert.match(code,/>Retry<\/button>/);
});
