import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readVerifiedRemittanceSnapshot, isVerifiedRemittanceSnapshot } from "../src/lib/statutory-remittance-snapshot-read";

const empty = () => ({
  organizationId: 14, legalEntity: { id: 77 }, batches: [],
  members: [], coverageGaps: [], alerts: [],
});
const batch = () => ({
  id: 4, organizationId: 14, legalEntityId: 77, agency: "SSS",
  applicableMonth: "2026-09", dueDate: "2026-10-10", status: "open", displayStatus: "open",
  employeeCount: 1, expectedEmployeeShare: "100.00", expectedEmployerShare: "120.00",
  expectedTotal: "220.00", amountPaid: null, paymentReference: null,
  agencyReceiptReference: null, paidAt: null, pendingPostingCount: 1, exceptionCount: 0,
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
  ]) await assert.rejects(() => readVerifiedRemittanceSnapshot(14, 77, fake(response)));
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
