import assert from "node:assert/strict";
import test from "node:test";
import {compareLoyverseAggregates} from "../scripts/wfm-loyverse-reconcile.mjs";
const bins=Array(48).fill(0).map((_,i)=>i===18?3:0);
const scope={organizationId:101,worksiteId:202};
const api={
  readOnly:true,applied:false,source:"loyverse_pos_sales",
  workDate:"2026-09-20",intervalMinutes:30,
  scope,intervalCounts:bins,countedSales:3,scannedReceipts:4,
  scannedPages:2,changedIntervals:48,unchangedIntervals:0,
  observedAsOf:"2026-10-12T00:00:00.000Z",
  boundary:"Source-reported only, not independently certified",
};
const backoffice={
  source:"independent_loyverse_backoffice_aggregate",scope,
  workDate:"2026-09-20",intervalMinutes:30,
  intervalCounts:bins,generatedAt:"2026-10-12T00:00:00.000Z",
};
test("exact bin count match does not imply independently signed operator approval",()=>{
  const result=compareLoyverseAggregates(api,backoffice);
  assert.equal(result.status,"count_match_unattested");
  assert.equal(result.mismatchedIntervals,0);
  assert.equal(result.humanSignoff,"NOT_EXECUTED");
  assert.match(result.sourceEvidenceSha256,/^[a-f0-9]{64}$/);
});
test("offsetting bin errors cannot hide behind matching daily totals",()=>{
  const changed=[...bins];changed[18]=2;changed[19]=1;
  const result=compareLoyverseAggregates(api,{...backoffice,intervalCounts:changed});
  assert.equal(result.status,"count_mismatch_review_required");
  assert.equal(result.apiTotal,result.independentReportTotal);
  assert.equal(result.mismatchedIntervals,2);
  assert.equal(result.totalDifference,0);
});
test("tenant mismatch, partial rows and additional receipt payloads are rejected",()=>{
  assert.throws(()=>compareLoyverseAggregates(api,{...backoffice,
    scope:{organizationId:999,worksiteId:202}}));
  assert.throws(()=>compareLoyverseAggregates(api,{...backoffice,
    intervalCounts:bins.slice(1)}));
  assert.throws(()=>compareLoyverseAggregates({...api,
    receipt_number:"Not an aggregate"},backoffice));
  assert.throws(()=>compareLoyverseAggregates(api,{...backoffice,
    notes:"Raw data is not allowed"}));
  assert.throws(()=>compareLoyverseAggregates({...api,countedSales:100},backoffice));
});