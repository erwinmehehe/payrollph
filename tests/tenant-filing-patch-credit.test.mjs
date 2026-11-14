import {assertMkt01Receipt} from '../scripts/qa/tenant-mkt01-marketing-credit.mjs';
import {verifyXenditPostCredit} from '../scripts/qa/tenant-xendit-post-credit.mjs';
import {verifyStudioPostCredit,STUDIO_POST_PATH} from '../scripts/qa/tenant-studio-post-credit.mjs';
import {verifyApprovalsCredit,APPROVALS_PATH} from '../scripts/qa/tenant-approvals-credit.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {baseTenantManifest} from './helpers/tenant-counts.mjs';
import {filingEvidence,verifyFilingPatchCredit,FILING_PATH,RECEIPT_FILE,withFilingStatusBanner} from '../scripts/qa/tenant-filing-patch-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('credit checkpoint replaces stale or duplicate banners without losing other proof history',()=>{
 const m=manifest().metrics,history='> **PR #1891 BIR receipt — retain unchanged**\n\n# Frozen queue\n';
 const stale='> **SOLO_VERIFIED_DEV_RECOVERY — filing PATCH proposal, NOT production acceptance:** old wording and counts\n\n';
 const expected=withFilingStatusBanner(history,m,16);
 for(const text of [history,stale+history,stale+stale+history,expected]){
  const result=withFilingStatusBanner(text,m,16);
  assert.equal(result,expected);assert.equal(withFilingStatusBanner(result,m,16),result);
  assert.ok(result.endsWith(history));assert.ok(result.includes('16 page/action gaps remain'));
 }
 assert.ok(withFilingStatusBanner(expected,m,15).includes('15 page/action gaps remain'));
});
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
test('filing pass preserves six independent holds and the distinct BIR and billing credits',()=>{
 const m=manifest();assert.equal(verifyApprovalsCredit(m),1);
 for(const [route,verb]of [['payroll-runs/[id]/exports','POST'],['payroll-runs/[id]/xendit-payout','POST'],['hcm/work-items/escalate','POST'],['marketing/leads','GET'],['automation-studio','POST']]){
  if(isVerifiedOracleSupersession(m,'src/app/api/'+route+'/route.ts',verb)) continue;
  if(route==='automation-studio'){assert.equal(verifyStudioPostCredit(m),1);continue;}
  if(route==='payroll-runs/[id]/xendit-payout'){assert.equal(verifyXenditPostCredit(m),1);continue;}
  if(route==='payroll-runs/[id]/exports'){const x=m.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(y=>y.name==='POST');assert.equal(x.status,'COVERED');assert.equal(x.testedBy.file,'scripts/qa/tenant-payroll-exports-post-http.mjs');continue;}
  const row=m.allApiRouteFiles['src/app/api/'+route+'/route.ts'].methods.find(x=>x.name===verb);
   if(route==='marketing/leads') {
     assert.equal(assertMkt01Receipt(m),1,'Operator MKT-01 requires its exact-source PG16 proof');
     assert.equal(row.status,'COVERED');
     continue;
   }
   if(route==='hcm/work-items/escalate') {
     assert.equal(row.status,'PRIVILEGED-OPERATIONS-TOKEN-ONLY');
     assert.equal(row.privilegedOperation?.methodCoverageCredits,0);
     assert.equal(row.privilegedOperation?.credentialEnvironment,'HCM_SLA_CRON_SECRET');
   } else assert.equal(row.status,'GAP');
   assert.equal(row.testedBy,null);
 }
 const billing=m.allApiRouteFiles['src/app/api/billing/route.ts'].methods.find(x=>x.name==='POST');
 assert.equal(billing.status,'COVERED');
 assert.equal(billing.testedBy?.workflowRunId,42809117765);
 const base=baseTenantManifest();assert.ok(base?.manifest,'inspectable base required');
 const path='src/app/api/bir/annual-employer/candidate/route.ts';
 assert.equal(base.manifest.allApiRouteFiles[path].methods[0].status,'COVERED');
 assert.deepEqual(m.allApiRouteFiles[path],base.manifest.allApiRouteFiles[path],'preserve exact inherited BIR route and receipt, never count it as this pass');
});
import { isVerifiedOracleSupersession } from "../scripts/qa/payroll-run-oracle-hold.mjs";
