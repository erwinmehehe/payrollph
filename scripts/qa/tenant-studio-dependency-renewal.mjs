/** Fresh executed replacement evidence for the exact Studio recovery change.
 * Historical receipts remain immutable; no source-only drift waiver exists. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {assertReviewedReadinessHeaderOnInvitationConfig} from './tenant-invitation-header-source-compat.mjs';

export const RENEWAL_FILE='scripts/qa/tenant-studio-dependency-renewal-receipt.json';
const SEALED='dd41a5f4ac55c683a4281e22946494cb3a2319e3';
export const ENGINE='src/lib/automation.ts';
const OLD_ENGINE='288d27789e062803d68ea38fd41fa78ee155a1ee';
const CURRENT_ENGINE='edb8330bc19362fb6828247eeddfb2f0c6169795';
const SCOPE='src/lib/automation-recovery-scope.ts';
const SCOPE_SHA='ff3dddff0e7ddea20a7be24792d84503a540202e';
const families=['approvals','enterprise','security-writes','spend-managed','document-callers'];
export function blob(raw){const b=Buffer.from(raw.toString().replaceAll('\r\n','\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
function stable(value){return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;}
export const jobSpecSha=job=>createHash('sha256').update(JSON.stringify(stable(job))).digest('hex');
export function verifyRenewalResults(r){
 assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.execution,'github-actions-pg16-http');
 assert.equal(r.productionAccepted,false);assert.equal(r.independentlyAccepted,false);assert.equal(r.credits,0);
 assert.deepEqual(Object.keys(r.families).sort(),[...families].sort());
 const jobs=Object.values(r.families).flatMap(f=>f.jobs);
 assert.equal(jobs.length,10);assert.equal(new Set(jobs.map(j=>j.job)).size,10,'A dependency job cannot be borrowed for another proof/profile');
 for(const [family,f]of Object.entries(r.families))assert.equal(f.jobs.length,family==='approvals'?6:1);
 for(const f of Object.values(r.families))for(const j of f.jobs){
  assert.equal(j.conclusion,'success');assert.match(j.head,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(j.job)&&j.job>0);
  assert.ok(Number.isSafeInteger(j.run)&&j.run>0);assert.ok(j.results.length||j.lines.length,'Executed output required');
 }
 const a=r.families.approvals;assert.equal(a.jobs.length,6);
 assert.deepEqual(a.jobs.map(j=>j.proof).sort(),['task','sources','flows','types','money-false','money-true'].sort());
 const result=(family,kind)=>r.families[family].jobs.flatMap(j=>j.results).find(kind);
 const task=result('approvals',x=>x.kind==='tenant-approval-task-isolation');assert.ok(task);
 assert.deepEqual(task.realOwnedDecisions,['Declined','Approved']);
 for(const k of ['higherIdVictim','victimOwnPositive','foreignAndPeerPath404','fullVictimSnapshotUnchanged','payrollAndPeopleUnchanged'])assert.equal(task[k],true,k);
 const types=result('approvals',x=>x.realHttpPostgres16===true);assert.ok(types);
 assert.deepEqual([types.ownWrites,types.victimDenials,types.forgedLinkDenials,types.auditRollbacks,types.discriminations],[19,18,4,18,9]);
 const sources=result('approvals',x=>x.kind==='tenant-approval-sources-isolation'),flows=result('approvals',x=>x.kind==='tenant-approval-flows-isolation');
 assert.equal(sources?.sources.length,4);assert.equal(flows?.families.length,4);
 for(const x of [sources,flows]){assert.equal(x.independentAttackers,2);assert.equal(x.fullSnapshotsUnchanged,true);assert.equal(x.victimOwnPositive,true);}
 for(const j of a.jobs.filter(j=>j.proof.startsWith('money-')))assert.deepEqual(j.lines,['Money lifecycle HTTP PASS: 301 assertions, 42 denied requests with unchanged victim snapshots.']);
 const e=result('enterprise',x=>x.kind==='ENTERPRISE_ADMIN_HTTP');assert.ok(e);
 assert.deepEqual([e.attackers,e.ownTransitions,e.auditVetoRollbacks,e.foreignDenials,e.forgedDenials,e.readPairs,e.readDiscriminating,e.writeDiscriminating],[2,42,42,42,22,2,2,42]);assert.equal(e.actualProviderTraffic,false);
 const security=r.families['security-writes'].jobs.flatMap(j=>j.results);
 const docs=security.filter(x=>x.kind==='fictional-document-upload-tenant-proof');assert.equal(docs.length,2);
 assert.deepEqual(docs.map(x=>x.vaultProfile).sort(),[false,true]);
 for(const x of docs){assert.deepEqual([x.attackerEmployers,x.ownPersistedUploads,x.tenantAndInputDenials,x.auditVetoRollbacks,x.documentDiscriminators],[2,6,10,2,6]);assert.equal(x.simulatedScannerOnly,true);}
 const bio=security.find(x=>x.family==='BIO-01'),dev=security.find(x=>x.kind==='TENANT_DEVELOPER_API_KEYS_POST');assert.ok(bio&&dev);
 assert.deepEqual([bio.ownDeviceIngested,bio.ownSessionIngested,bio.biometricDiscriminators,bio.deniedChecks],[2,2,4,9]);assert.equal(bio.trueHigherIdVictimImmutable,true);
 assert.deepEqual([dev.independentAttackers,dev.ownedCreateAndRevoke,dev.webhookCreates,dev.webhookTests,dev.mutationDiscriminators,dev.auditRollbacks],[2,2,2,2,4,6]);assert.equal(dev.victimSqlAndAuditUnchanged,true);
 const spend=result('spend-managed',x=>x.target==='POST and PATCH /api/spend'),managed=result('spend-managed',x=>x.kind==='MANAGED_CLIENT_APPROVAL_HTTP');assert.ok(spend&&managed);
 assert.deepEqual(spend.postActions,['category_policy','card','transaction','report']);assert.deepEqual(spend.patchDecisions,['approved','rejected']);
 for(const k of ['foreignAndForgedDenied','actualSqlStateVerified','higherIdVictimImmutable'])assert.equal(spend[k],true,k);assert.equal(spend.providerCalls,0);
 assert.deepEqual([managed.attackers,managed.ownApprovals,managed.ownReapprovals],[2,2,2]);
 for(const k of ['revocationRace','checkerSupersessionRace','legacyCheckerIdentityDenied','auditFailureRollback'])assert.equal(managed[k],true,k);
 const caller=result('document-callers',x=>x.kind==='DOCUMENT_CALLER_REPROOF');assert.ok(caller);assert.equal(caller.result,'PASS');
 assert.deepEqual([caller.employers,caller.attackers,caller.credits,caller.providerCalls],[3,2,0,0]);return true;
}
export function readStudioDependencyRenewal(read=readFileSync){
 const raw=read(RENEWAL_FILE);assert.equal(blob(raw),SEALED,'Fresh dependency execution receipt changed');const r=JSON.parse(raw);
 verifyRenewalResults(r);assert.equal(r.previousEngineBlob,OLD_ENGINE);assert.equal(r.inputBlobs[ENGINE],CURRENT_ENGINE);assert.equal(r.inputBlobs[SCOPE],SCOPE_SHA);
 assert.equal(Object.keys(r.historicalReceipts).length,4,'Historical receipt set must remain immutable');
 for(const [p,sha]of Object.entries(r.historicalReceipts))assert.equal(blob(read(p)),sha,'Historical receipt was rewritten: '+p);
 assert.ok(Object.keys(r.inputBlobs).length>=200,'Complete transitive source union required');
 for(const [p,sha]of Object.entries(r.inputBlobs)){
  if(p==='next.config.ts') assertReviewedReadinessHeaderOnInvitationConfig(read(p),sha);
  else if(p==='src/lib/security-network.ts') assertHistoricalPinnedNetworkPreserved(read(p),sha,read);
  else assert.equal(blob(read(p)),sha,'Renewed runtime/proof source drift: '+p);
 }
 for(const f of Object.values(r.families))for(const job of f.jobs){
  const workflow=yaml.load(read(job.workflow,'utf8'));assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.equal(jobSpecSha(workflow.jobs[job.jobKey]),job.jobSpecSha,'Executed job recipe changed: '+job.proof);
 }
 return r;
}
export function assertReciptedStudioEngine(family,p,historicalSha,read=readFileSync){
 assert.equal(p,ENGINE);assert.equal(historicalSha,OLD_ENGINE);
 const r=readStudioDependencyRenewal(read);assert.ok(r.families[family],'Unproved dependency family');return true;
}
export function studioDependencyRenewalRef(family,read=readFileSync){
 const r=readStudioDependencyRenewal(read);assert.ok(r.families[family]);return {receiptFile:RENEWAL_FILE,receiptBlobSha:SEALED,family,
  jobs:r.families[family].jobs.map(j=>({id:j.job,run:j.run,sourceHead:j.head})),engineBlob:CURRENT_ENGINE,scopeBlob:SCOPE_SHA,
  evidenceLabel:r.label,productionAccepted:false,independentlyAccepted:false};
}
import {assertHistoricalPinnedNetworkPreserved} from './tenant-node22-pinned-source-compat.mjs';
