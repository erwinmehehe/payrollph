/** Whole Studio POST requires the complete action cohort, not one successful
 * recovery or a provider-disabled refusal. No production acceptance is granted. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {blob,readStudioDependencyRenewal,jobSpecSha} from './tenant-studio-dependency-renewal.mjs';
import yaml from 'js-yaml';
import {assertReviewedReadinessHeaderOnInvitationConfig} from './tenant-invitation-header-source-compat.mjs';

export const STUDIO_POST_PATH='src/app/api/automation-studio/route.ts';
export const STUDIO_RECEIPT='scripts/qa/tenant-studio-post-credit-receipt.json';
const SEALED='f75b1436996f98ffe40be2f0a785700530583e0e';
const ACTIONS=Object.freeze({
 'quarantine-execution-step':'execution','triage-operational-case':['triage','resolution','scope'],
 'retry-execution-step':['scope','sessions'],'replay-execution':['scope','sessions'],
 'draft-from-language':'language','save-language-draft':'language',
 'create-from-template':'draft','save-rule':'draft','publish-rule':'lifecycle',
 'rollback-rule':'lifecycle','set-active':'lifecycle',
});
export function verifyStudioPostResults(r){
 assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.postgresMajor,16);
 assert.equal(r.providerCalls,0);assert.equal(r.productionAccepted,false);assert.equal(r.independentlyAccepted,false);
 assert.deepEqual(r.actionProofs,ACTIONS);assert.deepEqual(Object.keys(r.cohort).sort(),['triage','draft','lifecycle','execution','resolution','language','scope','sessions'].sort());
 assert.equal(new Set(Object.values(r.cohort).map(j=>j.job)).size,8,'Eight distinct executed proof jobs required');
 for(const j of Object.values(r.cohort)){assert.equal(j.conclusion,'success');assert.ok(Number.isSafeInteger(j.job)&&j.job>0);assert.ok(Number.isSafeInteger(j.run)&&j.run>0);assert.match(j.head,/^[a-f0-9]{40}$/);}
 const data=k=>r.cohort[k].result;
 const sessions=data('sessions');
 for(const key of ['fictionalPG16','twoForeignEmployers','higherIdVictim','ownRetry','ownReplay','foreignSessionsUnchanged','sharedAccountFailClosed','employerMembershipDeactivation','sharedGlobalSessionPreserved'])assert.equal(sessions[key],true,key);
 assert.equal(sessions.providerCalls,0);assert.equal(sessions.moneyMoved,false);assert.equal(sessions.newMethodCredits,0);assert.equal(sessions.productionAccepted,false);
 const t=data('triage');assert.deepEqual([t.ownSuccess,t.foreignDenials,t.negativeChecks],[2,4,18]);assert.equal(t.higherIdVictim,true);assert.equal(t.readOnlyAuthoritativeSources,true);
 const d=data('draft');assert.deepEqual([d.ownCreates,d.ownUpdates,d.foreignDenials,d.otherDenials],[5,2,8,10]);assert.equal(d.victimSQLUnchangedByAttackers,true);assert.equal(d.automationExecutions,0);
 const l=data('lifecycle');assert.deepEqual([l.ownedPublications,l.ownedActivations,l.ownedDisables,l.ownedRollbacks,l.foreignDenials,l.otherDenials],[2,2,2,2,22,19]);assert.equal(l.allTenantSqlProtected,true);assert.equal(l.noExternalProviders,true);
 const e=data('execution');assert.deepEqual([e.ownQuarantines,e.ownAcknowledgements,e.ownRetries,e.ownResolves,e.ownReopens,e.ownReplays,e.foreignDenials,e.otherDenials],[2,2,2,2,2,2,24,20]);assert.equal(e.foreignAndOwnSqlBound,true);assert.equal(e.noExternalProviderCalls,true);
 const resolution=data('resolution');assert.deepEqual([resolution.ownSuccess,resolution.foreignDenials,resolution.negativeChecks,resolution.auditRollbacks],[4,12,56,4]);assert.equal(resolution.victimBusinessIdsOverSix,true);
 const language=data('language');assert.deepEqual([language.ownProposals,language.ownSaves,language.denials,language.discriminations],[3,3,44,12]);assert.equal(language.providerCalls,0);assert.equal(language.persistedOwnDrafts,true);
 const scope=data('scope');assert.deepEqual([scope.own,scope.denials,scope.discriminations,scope.locks],[16,64,16,1]);assert.equal(scope.realWorkerSessionEffects,true);assert.equal(scope.unchangedVictim,true);
 assert.equal(scope.twoAttackers,true);assert.equal(scope.higherIdVictim,true);assert.equal(scope.providerCalls,0);
 assert.equal(language.twoAttackers,true);assert.equal(language.higherIdVictim,true);
 assert.equal(t.twoIndependentOwners,true);assert.equal(d.victimRuleAndVersionIdsOverSix,true);
 assert.equal(l.independentAuthenticatedOwners,2);assert.equal(l.realVictimRuleAndVersionIdsAboveSix,true);
 assert.equal(e.twoIndependentAuthenticatedOwners,true);assert.equal(e.higherIdVictimOperationalResources,true);
 for(const j of Object.values(r.cohort))for(const flag of ['productionAccepted','independentlyAccepted','productionCertified','productionTested'])if(Object.hasOwn(j.result,flag))assert.equal(j.result[flag],false,flag);
 assert.deepEqual(scope.resolution?.families,['coverage_recovery','timesheet_escalation','missing_timesheet_escalation','attendance_resolution','payroll_readiness','statutory_followup']);
 assert.deepEqual([scope.resolution.own,scope.resolution.denials,scope.resolution.discriminations],[36,36,36]);assert.equal(scope.resolution.authoritativeSourcesUnchanged,true);
 return true;
}
export function readStudioPostReceipt(read=readFileSync){
 const raw=read(STUDIO_RECEIPT);assert.equal(blob(raw),SEALED,'Complete Studio execution receipt changed');
 const r=JSON.parse(raw);verifyStudioPostResults(r);readStudioDependencyRenewal(read);
 assert.equal(r.inputBlobs[STUDIO_POST_PATH],'3bfc6666644ca11b480cf2735e9563d46139ebf4','The actual Studio handler must have an executed source seal');
 assert.ok(Object.keys(r.inputBlobs).length>=200,'Complete current runtime/fixture/proof input union required');
 for(const [p,sha]of Object.entries(r.inputBlobs)){
  if(p==='next.config.ts') assertReviewedReadinessHeaderOnInvitationConfig(read(p),sha);
  else if(p==='scripts/qa/tenant-money-lifecycle-http.mjs'||p==='scripts/qa/tenant-table-rows/read/path-id.mjs') assertOracleCallerCompatible(p,sha,read);
  else assert.equal(blob(read(p)),sha,'Studio executed source drift: '+p);
 }
 for(const j of Object.values(r.cohort)){
  const workflow=yaml.load(read(j.workflow,'utf8'));assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.equal(jobSpecSha(workflow.jobs[j.jobKey]),j.jobSpecSha,'Studio execution recipe changed: '+j.workflow);
 }
 for(const [family,j]of Object.entries(r.cohort)){
  const script=family==='sessions'?'scripts/qa/tenant-automation-session-ownership-http.mjs':'scripts/qa/tenant-studio-'+(family==='scope'?'recovery-scope':family)+'-http.mjs';
  assert.equal(j.proofFile,script);assert.equal(j.proofBlobSha,r.inputBlobs[script]);
  assert.equal(j.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+j.run+'/job/'+j.job);
  if(j.result.sourceHead)assert.equal(j.result.sourceHead,j.head);
  if(j.result.sourceCommit)assert.equal(j.result.sourceCommit,j.head);
  if(j.result.proofBlobSha)assert.equal(j.result.proofBlobSha,j.proofBlobSha);
  for(const [p,sha]of Object.entries(j.result.sourceBlobs??{}))assert.equal(r.inputBlobs[p],sha,'Executed component input omitted: '+p);
 }
 const route=read(STUDIO_POST_PATH,'utf8').toString();
 const actions=[...route.matchAll(/if \(action === "([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(actions)].sort(),Object.keys(ACTIONS).sort(),'A Studio action lacks its complete proof');
 for(const [field,fragment]of Object.entries(r.anchors)){
  assert.ok(Number.isSafeInteger(fragment.line)&&fragment.line>0);
  assert.ok(read(fragment.file,'utf8').toString().split('\n')[fragment.line-1]?.includes(fragment.text),'Studio proof anchor changed: '+field);
 }
 return r;
}
export function expectedStudioPostProof(read=readFileSync){
 const r=readStudioPostReceipt(read),a=r.anchors;
 return {file:a.own.file,line:a.own.line,ownPositiveLine:a.own.line,foreignDenialLine:a.foreign.line,
  forgedSelectorLine:a.forged.line,unchangedDbLine:a.unchanged.line,writeDiscriminationLine:a.discrimination.line,
  routeBlobSha:r.inputBlobs[STUDIO_POST_PATH],proofBlobSha:r.inputBlobs[a.own.file],receiptFile:STUDIO_RECEIPT,receiptBlobSha:SEALED,
  recoveryCredit:'studio-post-complete',evidenceLabel:r.label,evidence:r.cohort.scope.evidence,cohort:Object.entries(r.cohort).map(([family,j])=>({family,job:j.job,run:j.run,sourceHead:j.head,evidence:j.evidence})),
  providerCalled:false,productionTested:false,independentlyAccepted:false,independentSecurityReview:'PENDING',
  scope:'Complete eleven-action provider-OFF/keyless Studio POST cohort; owned persisted states, two attackers, populated higher-ID victim, forged selectors, all six source families, unchanged foreign business/session/audits and recovery binding locks. External-model/provider and production acceptance remain separate.'};
}
export function verifyStudioPostCredit(m,read=readFileSync){
 const row=m.allApiRouteFiles[STUDIO_POST_PATH]?.methods.find(x=>x.name==='POST');
 assert.equal(row?.status,'COVERED');assert.equal(row.reviewedUncertified,undefined);
 assert.deepEqual(row.testedBy,expectedStudioPostProof(read));
 assert.equal(m.allApiRouteFiles[STUDIO_POST_PATH].gitBlobSha,row.testedBy.routeBlobSha);return 1;
}

function reconcileDocs(m,write){
 const pageGaps=m.scopedPages.filter(x=>x.status==='GAP').length;
 const prefix='> **SOLO_VERIFIED_DEV_RECOVERY — complete Studio POST proposal:** ';
 const banner=prefix+m.metrics.methods+' methods = '+m.metrics.coveredAfter+' COVERED + '+m.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+m.metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+m.metrics.gap+' GAP. Eleven actions, eight executed proof jobs and all six source families; '+pageGaps+' separate page/action gaps remain. No production or external-provider acceptance.\n\n';
 for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){
  const original=readFileSync(file,'utf8');let doc=original;
  let sourceHold='';
  if(doc.startsWith('> **PAYROLL RUN ORACLE — SOURCE HOLD:** ')){
   const end=doc.indexOf('\n\n');assert.ok(end>=0);
   sourceHold=doc.slice(0,end+2);doc=doc.slice(end+2);
  }
  while(doc.startsWith(prefix)){const end=doc.indexOf('\n');doc=end<0?'':doc.slice(end+1).replace(/^\n+/,'');}
  doc=sourceHold+banner+doc;
  if(file.includes('inventory')){
   for(const key of ['coveredAfter','gap'])doc=doc.replace(new RegExp('^\\| '+key+' \\| \\d+ \\|$','m'),'| '+key+' | '+m.metrics[key]+' |');
   doc=doc.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/,'**RELEASE BLOCKER:** '+m.metrics.gap+' API methods and '+pageGaps+' business-ID page entries')
    .replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/,'**NOT ACCEPTED**: '+m.metrics.gap+' method gaps and '+pageGaps+' page/action gaps');
   const lines=doc.split('\n'),index=lines.findIndex(x=>x.startsWith('| [`automation-studio` POST]('));assert.ok(index>=0);
   const cells=lines[index].split(' | ');cells[cells.length-2]='[complete Studio POST PG16 action cohort](../../scripts/qa/tenant-studio-post-credit-receipt.json) — 11 actions, six authoritative sources, two attackers';cells[cells.length-1]='**COVERED** |';lines[index]=cells.join(' | ');doc=lines.join('\n');
  }else{
   const section=doc.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];assert.ok(section);
   const total={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0},provisional=[];
   for(const block of ('### Batch DL-01 —'+section).split('### Batch ').slice(1)){
    const id=block.split(' ')[0],counts={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0};
    for(const line of block.split('\n').filter(l=>l.startsWith('- `')&&l.includes(' — [source](../../src/app/api/'))){const verb=line.split('`')[1].split(' ')[0],path=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[path].methods.find(x=>x.name===verb).status;assert.ok(Object.hasOwn(counts,status));counts[status]++;total[status]++;}
    if(!counts.GAP)provisional.push(id);
    doc=doc.split('\n').map(line=>{const cells=line.split('|');if(cells.length!==10||cells[2].trim()!=='**'+id+'**')return line;cells[4]=' '+counts.COVERED+' ';cells[5]=' '+counts['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+counts['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' ';cells[7]=' '+counts.GAP+' ';cells[8]=counts.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');}).join('\n');
   }
   assert.equal(Object.values(total).reduce((a,b)=>a+b,0),406);
   doc=doc.replace(/^Frozen subtotal[^\n]+/m,line=>line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,'**'+total.COVERED+' COVERED + '+total['PUBLIC-BY-DESIGN']+' PUBLIC-BY-DESIGN + '+total['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+total.GAP+' GAP = 406**')
    .replace(/\d+ batches remain INCOMPLETE; [^.]+ remain PROVISIONAL — NOT ACCEPTED\./,(12-provisional.length)+' batches remain INCOMPLETE; '+provisional.join(', ')+' remain PROVISIONAL — NOT ACCEPTED.'));
  }
  if(write)writeFileSync(file,doc);else assert.equal(original,doc,'Tracking document requires the same reviewed Studio reconciliation: '+file);
 }
}

export function reconcileStudioPostCredit({write=false}={}){
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',m=JSON.parse(readFileSync(path,'utf8'));
 const before={covered:m.metrics.coveredAfter,gap:m.metrics.gap},row=m.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST');
 if(row.status==='GAP'){
  assert.equal(row.testedBy,null);row.testedBy=expectedStudioPostProof();row.status='COVERED';delete row.reviewedUncertified;
  row.reason='SOLO_VERIFIED_DEV_RECOVERY: complete source-sealed eleven-action PG16 HTTP Studio cohort, all six operational sources, persisted own recovery/session/access/benefit effects, real victim/forged denials and unchanged foreign SQL. External providers and production acceptance are not granted.';
 }else if(write){
  const renewed=expectedStudioPostProof();assert.equal(row.status,'COVERED');assert.equal(row.testedBy?.recoveryCredit,'studio-post-complete');
  assert.equal(row.testedBy.file,renewed.file);assert.equal(row.testedBy.proofBlobSha,renewed.proofBlobSha,'A different proof requires separate review');
  row.testedBy=renewed;
 }
 verifyStudioPostCredit(m);
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 for(const [field,status]of [['coveredAfter','COVERED'],['gap','GAP'],['publicByDesign','PUBLIC-BY-DESIGN'],['privilegedOperationsTokenOnly','PRIVILEGED-OPERATIONS-TOKEN-ONLY']])m.metrics[field]=all.filter(x=>x.status===status).length;
 assert.ok(before.covered===m.metrics.coveredAfter||before.covered+1===m.metrics.coveredAfter);
 assert.equal(before.covered+before.gap,m.metrics.coveredAfter+m.metrics.gap,'No unrelated reclassification');
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
 const note=' SOLO_VERIFIED_DEV_RECOVERY Studio POST credit: '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' GAP; complete current-source action cohort, no production acceptance.';
 if(!m.acceptanceStatus.includes(note.trim()))m.acceptanceStatus+=note;
 reconcileDocs(m,write);
 if(write)writeFileSync(path,JSON.stringify(m,null,2)+'\n');
 else assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),m,'Run the reviewed Studio credit writer with --write first');
 return {credited:m.metrics.coveredAfter-before.covered,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},write};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(process.argv.length===3&&['--check','--write'].includes(process.argv[2]));
 console.log(JSON.stringify(reconcileStudioPostCredit({write:process.argv[2]==='--write'})));
}
import {assertOracleCallerCompatible} from './payroll-run-oracle-source-compat.mjs';
