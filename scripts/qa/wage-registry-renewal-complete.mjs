/** Reuse the earlier full-method result contracts, with genuinely NEW execution. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyStudioPostResults} from './wage-registry-renewal-studio-results.mjs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_COHORTS} from './payroll-run-credit-renewal-contract.mjs';
const find=(jobs,predicate)=>{for(const j of jobs||[])for(const result of j.results||[])if(predicate(result))return {j,result};throw new Error('Missing actual complete-method result/artifact');};
const cohort=({j,result})=>({conclusion:j.conclusion,postgresMajor:16,transport:'real-http',sourceHead:j.sourceHead,runId:j.runId,jobId:j.jobId,result});
function studio(families){
 const baseline=JSON.parse(readFileSync('scripts/qa/tenant-studio-post-credit-receipt.json','utf8'));
 const current={label:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,providerCalls:0,productionAccepted:false,independentlyAccepted:false,actionProofs:baseline.actionProofs,cohort:{}};
 for(const [family,old]of Object.entries(baseline.cohort)){
  const actual=find(families[family],r=>old.result.family?r.family===old.result.family:r.fictionalPG16===true&&r.foreignSessionsUnchanged===true);
  current.cohort[family]={job:actual.j.jobId,run:actual.j.runId,head:actual.j.sourceHead,conclusion:actual.j.conclusion,result:actual.result};
 }
 verifyStudioPostResults(current);
}
function payrollCohorts(families){
 const c={};
 const optional=(name,family,predicate)=>{try{c[name]=cohort(find(families[family],predicate));}catch{/* Missing outputs keep their dependent methods HELD. */}};
 optional('boundary','oracle',r=>r.methods===19&&r.comparisons===76);
 optional('readTable','table',r=>r.kind==='tenant-table-proof'&&r.profile==='flagged-reads');
 optional('exportsPost','exports',r=>r.kind==='tenant-payroll-exports-post-isolation');
 optional('actions','payroll',r=>r.kind==='tenant-payroll-run-actions-isolation');
 optional('creation','payroll',r=>r.kind==='payroll-run-creation-renewal-real-http');
 optional('paymongo','paymongo',r=>r.status==='PASS'&&Array.isArray(r.successes)&&Array.isArray(r.receipts)&&Object.hasOwn(r,'providerCalls'));
 optional('moneyOff','approvals',r=>r.status==='PASS'&&r.exactLinks===false);
 optional('moneyOn','approvals',r=>r.status==='PASS'&&r.exactLinks===true);
 try{
  const summary=find(families.security,r=>r.kind==='SYNTHETIC_REAL_HTTP_ONLY');
  c.secondPass=cohort({...summary,result:{summary:summary.result,
   highRisk:find(families.security,r=>r.batch==='high-risk-01').result,
   closePost:find(families.security,r=>r.kind==='payroll-close-post-real-http-isolation').result,
   readSweep:find(families.security,r=>r.kind==='SYNTHETIC_PG_ONLY'&&r.protectedMethods===6).result}});
 }catch{/* Whole sweep must finish, not only its setup/first successful case. */}
 return c;
}
export function verifyCompleteWageMethod(entry,families){
 const key=entry.verb+' '+entry.path.slice('src/app/api/'.length,-'/route.ts'.length);
 if(key==='POST automation-studio')studio(families);
 if(PAYROLL_RENEWAL_COHORTS[key])verifyPayrollRenewalResults({schema:'payrollph-payroll-run-credit-renewal-v1',label:'SOLO_VERIFIED_DEV_RECOVERY',independentlyAccepted:false,productionCertified:false,liveActivation:false,methods:[key],cohorts:payrollCohorts(families)});
 if(key==='PATCH approvals/[id]'){
  // Payroll approvals require both exact-link artifacts in addition to all
  // task/source/flow/type own/victim/forged/immutable-SQL assertions.
  const jobs=families.approvals,task=find(jobs,r=>r.kind==='tenant-approval-task-isolation').result;
  assert.deepEqual(task.realOwnedDecisions,['Declined','Approved']);
  for(const flag of ['higherIdVictim','victimOwnPositive','foreignAndPeerPath404','fullVictimSnapshotUnchanged','payrollAndPeopleUnchanged'])assert.equal(task[flag],true,flag);
  for(const kind of ['tenant-approval-sources-isolation','tenant-approval-flows-isolation']){
   const r=find(jobs,x=>x.kind===kind).result;assert.equal(r.independentAttackers,2);assert.equal(r.fullSnapshotsUnchanged,true);assert.equal(r.victimOwnPositive,true);
  }
  for(const exact of [false,true]){const r=find(jobs,x=>x.status==='PASS'&&x.exactLinks===exact).result;assert.equal(r.transport,'real-http');assert.equal(r.assertions,301);assert.ok(r.successes.filter(x=>x.route==='approvals/[id]'&&x.ownSuccess===true).length>=2);assert.ok(r.receipts.every(x=>x.unchangedVictim===true));}
 }
 return true;
}
