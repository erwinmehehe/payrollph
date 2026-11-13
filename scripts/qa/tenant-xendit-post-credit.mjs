/** Restricted one-method promotion from an inspected, completed PG16 job. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {reconcilePayrollRenewal} from './payroll-run-credit-renewal.mjs';
import {reconcileStudioPostCredit} from './tenant-studio-post-credit.mjs';
export const XENDIT_POST_PATH='src/app/api/payroll-runs/[id]/xendit-payout/route.ts';
export const XENDIT_POST_RECEIPT='scripts/qa/tenant-xendit-post-executed-receipt.json';
const HARNESS='scripts/qa/tenant-xendit-post-proof-http.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md';
const PLAN='docs/engineering/tenant-isolation-closure-plan.md';
const blob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex');
const seal=b=>createHash('sha256').update(b).digest('hex');
export function readXenditPostExecution(read=readFileSync){
 const raw=read(XENDIT_POST_RECEIPT);
 assert.equal(seal(raw),'363edbf02d4e2df3226313d060ad559c28a2f44e82790294d9700d695f0a5572','Executed Xendit receipt changed');
 const r=JSON.parse(raw);
 assert.equal(r.sourceCommit,'5c5294b9dc203550ac70f481e747a42685a23269');
 assert.equal(r.workflowRunId,43440091136);assert.equal(r.workflowJobId,131935148448);
 assert.equal(r.jobConclusion,'success');
 assert.equal(r.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/43440091136/job/131935148448');
 assert.equal(r.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(r.independentSecurityReview,'PENDING');assert.equal(r.productionTested,false);
 assert.equal(r.profileApproval,'synthetic-only-user-approved');
 assert.equal(Object.keys(r.inputs).length,70,'Complete executed local-module closure required');
 for(const root of r.roots)assert.ok(r.inputs[root],'Missing executed root '+root);
 for(const[file,sha]of Object.entries(r.inputs))assert.equal(blob(read(file)),sha,'Executed Xendit input drift: '+file);
 const result=r.result,actions=['preflight','submit','reconcile','resolve-unknown'];
 assert.equal(result.sourceHead,r.sourceCommit);assert.deepEqual(result.actions,actions);
 assert.deepEqual(result.attackerOrganizationIds,[8,9]);assert.equal(result.victimOrganizationId,10);
 assert.equal(result.attackerEmployers,2);assert.equal(result.victimOwnPositive,true);
 assert.equal(result.own.length,12);
 for(const id of [8,9,10])assert.deepEqual(result.own.filter(x=>x.employerId===id).map(x=>x.action),actions);
 for(const item of result.own)assert.equal(item.ownSuccess,true);
 assert.equal(result.refusals.length,58);
 for(const item of result.refusals){assert.equal(item.unchangedProtectedSql,true);assert.equal(item.providerCalls,0);}
 for(const id of [8,9])for(const action of actions){
  for(const label of ['genuine foreign ','missing run '])assert.equal(result.refusals.filter(x=>
    x.employerId===id&&x.action===action&&x.status===404&&x.label===label+action).length,1);
 }
 assert.equal(result.missingComparisons,8);assert.equal(result.recoveries.length,3);
 for(const x of result.recoveries)for(const k of ['unknownWasPersisted','duplicateSendBlocked','readOnlyRecovery'])assert.equal(x[k],true);
 assert.equal(result.providerOffSendsBlocked,true);assert.equal(result.providerOffHistoricalRecovery,true);
 assert.equal(result.syntheticProviderRequests.filter(x=>x.method==='POST').length,7);
 assert.equal(result.syntheticProviderRequests.filter(x=>x.method==='GET').length,10);
 assert.equal(result.realProviderCalls,0);assert.equal(result.coverageCredits,0);
 assert.equal(result.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(result.independentlyAccepted,false);assert.equal(result.productionCertified,false);
 return r;
}
export function expectedXenditPostEvidence(read=readFileSync){
 const r=readXenditPostExecution(read),lines=read(HARNESS,'utf8').split('\n');
 const markers={line:'assert.equal(submitted.status,200',ownPositiveLine:'assert.equal(submitted.status,200',
  foreignDenialLine:'const foreign=await denied',unchangedDbLine:'assertXenditProtectedUnchanged(before,await snapshot(e),label)',
  forgedSelectorLine:'const wrongPayout=await request',discriminationLine:'assert.throws(()=>assertOwnedXenditLedger',
  twoAttackerLine:'for(const e of [a,b])for(const action',victimPositiveLine:'for(const e of [victim,a,b])'};
 const anchors={};for(const[k,fragment]of Object.entries(markers)){
  const matches=lines.flatMap((line,i)=>line.includes(fragment)?[i+1]:[]);
  assert.equal(matches.length,1,'Lost exact Xendit proof anchor '+k);anchors[k]=matches[0];
 }
 return{kind:'xendit-post-complete-real-http-pg16',file:HARNESS,...anchors,
  routeBlobSha:r.inputs[XENDIT_POST_PATH],proofBlobSha:r.inputs[HARNESS],
  workflowFile:'.github/workflows/tenant-xendit-post-proof.yml',
  workflowBlobSha:r.inputs['.github/workflows/tenant-xendit-post-proof.yml'],
  sourceHead:r.sourceCommit,workflowRunId:r.workflowRunId,workflowJobId:r.workflowJobId,evidence:r.evidence,
  methodActions:r.result.actions,postgreSqlMajor:16,attackerEmployers:2,victimOwnPositive:true,
  ownOperations:12,protectedRefusals:58,realProviderCalls:0,
  evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',independentSecurityReview:'PENDING',
  independentlyAccepted:false,productionTested:false};
}
export function verifyXenditPostCredit(m,read=readFileSync){
 const route=m.allApiRouteFiles[XENDIT_POST_PATH],row=route?.methods.find(x=>x.name==='POST');
 const expected=expectedXenditPostEvidence(read);
 assert.equal(route.gitBlobSha,expected.routeBlobSha);assert.equal(blob(read(XENDIT_POST_PATH)),expected.routeBlobSha);
 assert.equal(row.status,'COVERED');assert.equal(row.reviewedUncertified,undefined);
 assert.deepEqual(row.testedBy,expected,'Xendit POST cannot borrow an older refusal-only or GET receipt');
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 assert.equal(all.filter(x=>x.status==='COVERED').length,m.metrics.coveredAfter);
 assert.equal(all.filter(x=>x.status==='GAP').length,m.metrics.gap);
 return 1;
}
export function creditXenditPost({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST)),row=m.allApiRouteFiles[XENDIT_POST_PATH].methods.find(x=>x.name==='POST');
 const before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 if(row.status==='COVERED'){verifyXenditPostCredit(m);return{write,before,after:before,newCredits:0};}
 assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
 assert.ok(write,'Xendit POST is still GAP; inspect the real receipt before --write');
 row.testedBy=expectedXenditPostEvidence();row.status='COVERED';delete row.reviewedUncertified;
 row.reason='Complete four-operation fictional PG16 real-HTTP proof: three own employer lifecycles, two attacker employers, genuine victim denials, forged provider references, unchanged protected SQL/audit, ambiguous-outcome recovery and provider-OFF controls. '+row.testedBy.evidence+'. SOLO_VERIFIED_DEV_RECOVERY; independent treasury/security and production acceptance PENDING.';
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 assert.equal(m.metrics.coveredAfter,before.covered+1);assert.equal(m.metrics.gap,before.gap-1);
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods')+
  ' Complete synthetic Xendit POST proof: '+row.testedBy.evidence+'; one provisional method, no production acceptance.';
 verifyXenditPostCredit(m);
 let inventory=readFileSync(INVENTORY,'utf8');
 const rows=inventory.split('\n'),at=rows.findIndex(x=>x.startsWith('| [`payroll-runs/[id]/xendit-payout` POST]'));
 assert.ok(at>=0&&rows[at].includes('| NO VALID METHOD PROOF | **GAP** |'));
 rows[at]=rows[at].replace('| NO VALID METHOD PROOF | **GAP** |','| [complete four-operation PG16]('+row.testedBy.evidence+') | **COVERED** |');
 inventory=rows.join('\n');
 const banner='> **SOLO_VERIFIED_DEV_RECOVERY — complete Xendit POST:** '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' API GAP. Four operations, two attacker employers, genuine victim positive, zero real providers. Independent and production acceptance PENDING.\n\n';
 const report=text=>{
  const lines=text.split('\n');
  if(lines[0].startsWith('> **SSO DEFAULT-OFF INTEGRATION HOLD'))
   lines[0]=lines[0].replace(/\d+ COVERED \/ \d+ PUBLIC-BY-DESIGN \/ \d+ TOKEN-ONLY \/ \d+ GAP/,
    m.metrics.coveredAfter+' COVERED / '+m.metrics.publicByDesign+' PUBLIC-BY-DESIGN / '+m.metrics.privilegedOperationsTokenOnly+' TOKEN-ONLY / '+m.metrics.gap+' GAP');
  return lines.join('\n').trimEnd()+'\n';
 };
 writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');writeFileSync(INVENTORY,report(inventory+'\n'+banner));
 writeFileSync(PLAN,report(readFileSync(PLAN,'utf8')+'\n'+banner));
 reconcilePayrollRenewal({write:true});reconcileStudioPostCredit({write:true});
 return{write,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},newCredits:1};
}
export function xenditPostCreditDelta(before,current){
 verifyXenditPostCredit(current);
 const prior=before.allApiRouteFiles[XENDIT_POST_PATH].methods.find(x=>x.name==='POST');
 if(prior.status==='COVERED'){verifyXenditPostCredit(before);return 0;}
 assert.equal(prior.status,'GAP');assert.equal(prior.testedBy,null);return 1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(['--write','--check'].includes(process.argv[2]));console.log(JSON.stringify(creditXenditPost({write:process.argv[2]==='--write'})));
}
