import assert from "node:assert/strict";
import test from "node:test";
import {isVerifiedPayoutRead,readVerifiedPayout,isVerifiedPayoutReconciliationReceipt} from "../src/lib/payout-reconciliation-read";
const scope={organizationId:41,runId:17,netPay:"100.00",employeeCount:1};
const transfer={batchId:"batch-1",transferId:"transfer-1",referenceNumber:"PAY-17-E001",employeeNo:"E001",status:"succeeded",amountCents:10000,providerReferenceNumber:null,providerError:null,providerErrorCode:null,occurredAt:null};
const sample={organizationId:41,runId:17,runNetPay:"100.00",runEmployeeCount:1,periodLabel:"Oct 2026",release:{done:true,at:null},bankFile:{status:"waiting",filename:null,template:null,generatedAt:null},payout:{status:"completed",label:"Settled",reference:null,method:"PayMongo",completedAt:null},reconciliation:{provider:"PayMongo",status:"settled",batchIds:["batch-1"],total:1,succeeded:1,pending:0,failed:0,unknown:0,checkedAt:null,canRetryFailed:false,settlementRegressed:false,transfers:[transfer]}};
test("payout snapshot verifies exact employer, amount, rows and genuine zeros",()=>{
  assert.equal(isVerifiedPayoutRead(sample,scope),true);
  const empty={...sample,payout:{...sample.payout,status:"awaiting-preflight"},reconciliation:{...sample.reconciliation,provider:null,status:"not-applicable",batchIds:[],total:0,succeeded:0,pending:0,failed:0,unknown:0,transfers:[]}};
  assert.equal(isVerifiedPayoutRead(empty,scope),true);
  for(const v of [{...sample,organizationId:99},{...sample,runId:18},{...sample,runNetPay:undefined},{...sample,runNetPay:"0.00"},
    {...sample,reconciliation:{...sample.reconciliation,failed:undefined}},
    {...sample,reconciliation:{...sample.reconciliation,transfers:[]}},
    {...sample,reconciliation:{...sample.reconciliation,pending:1}},
    {...sample,reconciliation:{...sample.reconciliation,status:"settled",succeeded:0,pending:1}},
    {...sample,reconciliation:{...sample.reconciliation,transfers:[{...transfer,amountCents:undefined}]}}]) {
    assert.equal(isVerifiedPayoutRead(v,scope),false,JSON.stringify(v));
  }
});
test("payout GET rejects non-OK, malformed, wrong org, missing fields; Retry restores verified result",async()=>{
  let status=502,malformed=false,body:unknown=sample,attempts=0;
  const fetcher=(async()=>({ok:(++attempts>0)&&status===200,json:async()=>{if(malformed)throw SyntaxError("fictional bad JSON");return body;}}as Response))as typeof fetch;
  await assert.rejects(()=>readVerifiedPayout(scope,fetcher),/unavailable/);
  status=200;malformed=true;
  await assert.rejects(()=>readVerifiedPayout(scope,fetcher),/unreadable/);
  malformed=false;body={...sample,organizationId:99};
  await assert.rejects(()=>readVerifiedPayout(scope,fetcher),/different employer/);
  body={...sample,reconciliation:{...sample.reconciliation,total:undefined}};
  await assert.rejects(()=>readVerifiedPayout(scope,fetcher),/incomplete/);
  body=sample;
  assert.deepEqual(await readVerifiedPayout(scope,fetcher),sample);
  assert.equal(attempts,5);
});
test("payout POST acknowledgement rejects partial counts and foreign receipts",()=>{
 const receipt={organizationId:41,runId:17,checkedAt:"2026-10-20T00:00:00Z",reconciliation:{total:1,succeeded:1,pending:0,failed:0,unknown:0,completed:true,transfers:[transfer],retryableReferences:[]}};
 assert.equal(isVerifiedPayoutReconciliationReceipt(receipt,41,17,false),true);
 assert.equal(isVerifiedPayoutReconciliationReceipt({...receipt,organizationId:99},41,17,false),false);
 assert.equal(isVerifiedPayoutReconciliationReceipt({...receipt,reconciliation:{...receipt.reconciliation,pending:undefined}},41,17,false),false);
});
