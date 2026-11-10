import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {baseTenantManifest} from './helpers/tenant-counts.mjs';
import {filingEvidence,verifyFilingPatchCredit,FILING_PATH,RECEIPT_FILE} from '../scripts/qa/tenant-filing-patch-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('only the complete three-leg current-main PG16 receipt authorizes one PATCH',()=>{
 assert.equal(verifyFilingPatchCredit(manifest()),1);
 const r=filingEvidence();assert.equal(r.accepted.realOwnAccepted200,2);assert.equal(r.rejectedLeg.actualOwnWrites,2);assert.equal(r.guards.boundedDenials,20);
 assert.equal(r.providerCalled,false);assert.equal(r.agencyCalled,false);
});
test('partial/rejected-only evidence and borrowed method receipts fail closed',()=>{
 for(const mutate of [m=>m.allApiRouteFiles[FILING_PATH].methods[0].status='GAP',m=>delete m.allApiRouteFiles[FILING_PATH].methods[0].testedBy.workflowJobs.accepted,m=>m.allApiRouteFiles[FILING_PATH].methods[0].testedBy.sourceHead='a'.repeat(40),m=>m.allApiRouteFiles[FILING_PATH].methods[0].testedBy.providerCalled=true,m=>m.allApiRouteFiles[FILING_PATH].gitBlobSha='a'.repeat(40)]){
  const m=manifest();mutate(m);assert.throws(()=>verifyFilingPatchCredit(m));
 }
});
test('changed source or fabricated receipt must be re-executed, never blindly repinned',()=>{
 const r=filingEvidence();
 for(const path of [RECEIPT_FILE,...Object.keys(r.inputBlobs)]){
  const reader=file=>file===path?Buffer.concat([readFileSync(file),Buffer.from('\n')]):readFileSync(file);
  assert.throws(()=>verifyFilingPatchCredit(manifest(),reader),undefined,path);
 }
});
test('this pass preserves the seven remaining holds and the BIR credit inherited from main',()=>{
 const m=manifest();
 for(const [route,verb]of [['approvals/[id]','PATCH'],['payroll-runs/[id]/exports','POST'],['payroll-runs/[id]/xendit-payout','POST'],['hcm/work-items/escalate','POST'],['marketing/leads','GET'],['automation-studio','POST'],['billing','POST']]){
  const row=m.allApiRouteFiles['src/app/api/'+route+'/route.ts'].methods.find(x=>x.name===verb);assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
 }
 const base=baseTenantManifest();assert.ok(base?.manifest,'inspectable base required');
 const path='src/app/api/bir/annual-employer/candidate/route.ts';
 assert.equal(base.manifest.allApiRouteFiles[path].methods[0].status,'COVERED');
 assert.deepEqual(m.allApiRouteFiles[path],base.manifest.allApiRouteFiles[path],'preserve exact inherited BIR route and receipt, never count it as this pass');
});
