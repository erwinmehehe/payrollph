import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {APPROVALS_PATH,APPROVALS_PINS,approvalEvidence,verifyApprovalsCredit} from '../scripts/qa/tenant-approvals-credit.mjs';
const load=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
test('one complete method uses all six successful HTTP executions and aggregator on the same source',()=>{
 const r=approvalEvidence();assert.equal(r.jobs.length,7);assert.equal(verifyApprovalsCredit(load()),1);
 for(const j of r.jobs)assert.equal(j.result,'success');
});
test('missing branches, changed execution receipts or current-source drift fail closed',()=>{
 const receipt='scripts/qa/tenant-approvals-recovery-receipt.json';
 assert.throws(()=>approvalEvidence(p=>p===receipt?Buffer.from(JSON.stringify({...JSON.parse(readFileSync(p)),jobs:[]})):readFileSync(p)));
 for(const path of Object.keys(APPROVALS_PINS))assert.throws(()=>approvalEvidence(p=>p===path?Buffer.concat([readFileSync(p),Buffer.from(' ')]):readFileSync(p)),undefined,path);
});
test('borrowed or partial method receipts cannot earn the approval credit',()=>{
 for(const mutate of [r=>r.status='GAP',r=>r.testedBy.workflowJobs.pop(),r=>r.testedBy.forgedSelectorLine=1,r=>r.testedBy.providerCalled=true,r=>r.testedBy.independentlyAccepted=true]){
 const m=load(),row=m.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==='PATCH');mutate(row);assert.throws(()=>verifyApprovalsCredit(m));
 }
});
