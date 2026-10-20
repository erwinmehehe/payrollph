import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseRemittanceCorrectionsRead } from "../src/lib/statutory-remittance-corrections-read";

const scope = { organizationId: 41, legalEntityId: 7, viewerUserId: 71 };
const batch = () => ({
  id: 101, organizationId: 41, legalEntityId: 7,
  agency: "SSS", applicableMonth: "2026-09", status: "reconciled",
  expectedTotal: "123.45", amountPaid: "123.45",
  paymentReference: "FICT-100", agencyReceiptReference: "REC-100",
  paymentChannel: "fictional", paymentVarianceNote: null, paidAt: "2026-10-19T10:00:00.000Z",
});
const member = () => ({
  id: 202, batchId: 101, organizationId: 41, legalEntityId: 7,
  employeeNo: "FICT-EMP", totalContribution: "123.45",
  postingStatus: "confirmed", postingReference: "POST-100", postedAmount: "123.45",
  postedAt: "2026-10-19T10:10:00.000Z",
});
const request = () => ({
  id: 303, organizationId: 41, targetType: "member_posting",
  batchId: 101, memberId: 202, originalSnapshot: { postedAmount: "123.45" },
  proposedSnapshot: { postedAmount: "123.40" }, reason: "Fictional posted amount mismatch",
  status: "pending", requestedByUserId: 72, requestedByName: "Fictional maker",
  decidedByName: null, decisionNote: null, createdAt: "2026-10-19T11:00:00.000Z",
});
const remittance = () => ({
  organizationId: 41, legalEntity: { id: 7, code: "FICT", displayName: "Fictional employer" },
  batches: [batch()], members: [member()],
});
const decisions = () => ({
  organizationId: 41, legalEntity: { id: 7 }, currentUserId: 71,
  canRequest: true, canApprove: true, corrections: [request()],
});

test("only complete aligned remittance batches, postings and requests may show approval controls", () => {
  const verified = parseRemittanceCorrectionsRead(remittance(), decisions(), scope);
  assert.equal(verified?.correctionData.corrections[0].id, 303);
  assert.deepEqual(parseRemittanceCorrectionsRead({
    ...remittance(), batches: [], members: [],
  }, { ...decisions(), corrections: [] }, scope)?.correctionData.corrections, []);
  for (const [r, d, expected] of [
    [{ ...remittance(), organizationId: 99 }, decisions(), scope],
    [remittance(), { ...decisions(), organizationId: 99 }, scope],
    [remittance(), { ...decisions(), currentUserId: 72 }, scope],
    [remittance(), { ...decisions(), canApprove: undefined }, scope],
    [{ ...remittance(), batches: [{ ...batch(), organizationId: 99 }] }, decisions(), scope],
    [{ ...remittance(), batches: [{ ...batch(), legalEntityId: 8 }] }, decisions(), scope],
    [{ ...remittance(), members: [{ ...member(), batchId: 999 }] }, decisions(), scope],
    [remittance(), { ...decisions(), legalEntity: { id: 8 } }, scope],
    [remittance(), { ...decisions(), corrections: [{ ...request(), organizationId: 99 }] }, scope],
    [remittance(), { ...decisions(), corrections: [{ ...request(), batchId: 999 }] }, scope],
    [remittance(), { ...decisions(), corrections: [{ ...request(), memberId: 999 }] }, scope],
    [remittance(), { ...decisions(), corrections: [{ ...request(), originalSnapshot: null }] }, scope],
    [remittance(), { ...decisions(), corrections: [request(), request()] }, scope],
  ] as const) {
    assert.equal(parseRemittanceCorrectionsRead(r, d, expected), null);
  }
  assert.equal(parseRemittanceCorrectionsRead({}, decisions(), scope), null);
  assert.equal(parseRemittanceCorrectionsRead(remittance(), {}, scope), null);
  assert.equal(parseRemittanceCorrectionsRead(remittance(), decisions(), { ...scope, viewerUserId: null }), null);
  assert.equal(parseRemittanceCorrectionsRead(remittance(), decisions(), { ...scope, legalEntityId: 8 }), null);
});

test("remittance requests use a selected-legal-employer read and retire stale authorization on refresh", () => {
  const route = readFileSync("src/app/api/compliance/statutory-remittance-corrections/route.ts", "utf8");
  const panel = readFileSync("src/components/workspace/statutory-remittance-corrections-panel.tsx", "utf8");
  const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.match(route, /resolveComplianceLegalEntity\(/);
  assert.match(route, /assertEntityResource\(context\.context, legalEntity\.id\)/);
  assert.match(route, /inArray\(statutoryRemittanceCorrectionRequests\.batchId, batchIds\)/);
  assert.match(route, /organizationId,\s*legalEntity: \{ id: legalEntity\.id \}/);
  assert.match(panel, /parseRemittanceCorrectionsRead\(remittanceBody, correctionBody, \{/);
  assert.match(panel, /setCorrectionData\(null\)/);
  assert.match(panel, /const verified = await load\(\)/);
  assert.match(panel, /return verified;/);
  assert.match(panel, /readRevisionRef\.current/);
  assert.match(payroll, /viewerUserId=\{data\.user\?\.id \?\? null\}/);
  assert.match(payroll, /legalEntityId=\{data\.multiEntity\?\.enabled/);
});
