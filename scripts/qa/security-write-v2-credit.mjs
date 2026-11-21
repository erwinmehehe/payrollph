/** Per-method source-closure receipt for the security-write methods whose old shared receipt was withdrawn
 * when the documents route changed (#2058). Fictional PG16 + real production HTTP only; never production acceptance.
 *
 * Each method is bound to its OWN executed closure plus a small global base, so a later change to the documents
 * route (or any other method's closure) cannot withdraw it again. Zero credits are written by the capture step.
 *
 *   node scripts/qa/security-write-v2-credit.mjs --check              verify rows against the receipt
 *   node scripts/qa/security-write-v2-credit.mjs --credit             promote the held rows (needs a sealed receipt)
 *   node scripts/qa/security-write-v2-credit.mjs --withdraw-drifted   demote rows whose closure drifted (zero credit)
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const SECURITY_V2_KIND='security-write-current-source-pg16-http-v2';
export const SECURITY_V2_SCHEMA='payrollph-security-write-source-pg16-v2';
export const SECURITY_V2_RECEIPT='scripts/qa/security-write-v2-receipt.json';
/** Set only after inspecting the real exact-head job and its output. */
export const SECURITY_V2_RECEIPT_BLOB='3d45e3f10381e6c0b38b7ab5fe8deb430b1247ec';
export const SECURITY_V2_MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
export const SECURITY_V2_WORKFLOW='.github/workflows/tenant-security-write-recovery.yml';
export const SECURITY_V2_JOB_STEP='Fresh fictional database per method/profile, real production HTTP';
export const SECURITY_V2_HOLD_KIND='document-metadata-shared-security-source-withdrawal-zero-credit';

/** Roots shared by every method of the family; each method adds its own route, proof and contract. */
export const SECURITY_V2_FAMILY_ROOTS=Object.freeze([
 SECURITY_V2_WORKFLOW,
 'scripts/qa/tenant-security-write-local.mjs','scripts/qa/tenant-security-write-local-contract.mjs',
 'scripts/qa/tenant-security-write-preload.mjs','scripts/qa/tenant-security-write-db.mjs',
 'scripts/qa/tenant-recovery-local-contract.mjs',
]);
/** Same global base as the wage receipt, minus the wage workflow itself. */
export const SECURITY_V2_EXCLUDED_GLOBALS=Object.freeze(['.github/workflows/wage-registry-renewal.yml']);

export const SECURITY_V2_TARGETS=Object.freeze([
 {key:'POST src/app/api/biometrics/sync/route.ts',verb:'POST',path:'src/app/api/biometrics/sync/route.ts',run:'biometrics',
  proof:'scripts/qa/tenant-bio01-biometric-http.mjs',contract:'scripts/qa/tenant-bio01-biometric-contract.mjs'},
 {key:'POST src/app/api/developer/route.ts',verb:'POST',path:'src/app/api/developer/route.ts',run:'developer',
  proof:'scripts/qa/tenant-developer-key-http.mjs',contract:'scripts/qa/tenant-developer-key-contract.mjs'},
]);
export const securityV2Target=key=>SECURITY_V2_TARGETS.find(t=>t.key===key);

export const blob=raw=>{const b=Buffer.from(raw);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
export const hasSecurityV2Receipt=()=>/^[a-f0-9]{40}$/.test(SECURITY_V2_RECEIPT_BLOB);
const SHA40=/^[a-f0-9]{40}$/;

/** What the proof itself printed for each family; the counters are the ones the original sealed receipt required. */
export function verifySecurityV2Results(results){
 assert.deepEqual(Object.keys(results).sort(),['biometrics','developer']);
 const bio=results.biometrics;
 assert.equal(bio.family,'BIO-01');assert.equal(bio.postgresMajor,16);assert.equal(bio.http,'production-mode loopback');
 assert.equal(bio.ownDeviceIngested,2);assert.equal(bio.ownSessionIngested,2);assert.equal(bio.biometricDiscriminators,4);
 assert.equal(bio.deniedChecks,9);assert.equal(bio.newCoverageCredits,0);assert.equal(bio.productionCertified,false);
 for(const k of ['trueHigherIdVictimImmutable','payrollUnchanged','replayCreatesNoSecondPunch','crossTenantBadgeUnmatched'])assert.equal(bio[k],true,'BIO-01 '+k);
 const dev=results.developer;
 assert.equal(dev.kind,'TENANT_DEVELOPER_API_KEYS_POST');assert.equal(dev.proof,'fictional-PG16-real-production-HTTP');
 assert.equal(dev.result,'PASS');assert.equal(dev.independentAttackers,2);assert.equal(dev.ownedCreateAndRevoke,2);
 assert.equal(dev.webhookCreates,2);assert.equal(dev.webhookTests,2);assert.equal(dev.mutationDiscriminators,4);
 assert.equal(dev.auditRollbacks,6);assert.equal(dev.webhookDeliveryAttempted,true);assert.equal(dev.newCoverageCredits,0);
 assert.equal(dev.production,false);assert.equal(dev.independentlyApproved,false);
 for(const k of ['realHigherIdVictim','foreignExistingAndMissingParity','bodySelectorForgeryConfinedToOwnEmployer','originGate',
  'actualEmployeeApiOwnDataBeforeRevocation','foreignEmployerQueryIgnoredForKey','revokedKeyDeniedAtConsumerViaBothHeaders',
  'unitScopeAndRevokedMembershipDenied','victimSqlAndAuditUnchanged'])assert.equal(dev[k],true,'developer '+k);
}

export function validateSecurityV2Receipt(r){
 assert.equal(r.schema,SECURITY_V2_SCHEMA);assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(r.productionAccepted,false);assert.equal(r.independentlyAccepted,false);assert.equal(r.creditsAtExecution,0);
 const e=r.execution;
 assert.equal(e.workflow,SECURITY_V2_WORKFLOW);assert.equal(e.conclusion,'success');
 assert.ok(Number.isSafeInteger(e.runId)&&Number.isSafeInteger(e.jobId));
 for(const k of ['testedHead','testedMerge','base'])assert.match(e[k],SHA40,k);
 assert.equal(e.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+e.runId+'/job/'+e.jobId);
 assert.ok(e.steps.length>0&&e.steps.every(s=>['success','skipped'].includes(s.conclusion)),'Every job step must succeed');
 for(const name of ['Run npm ci',SECURITY_V2_JOB_STEP,'Build once, no external providers or credentials'])
  assert.ok(e.steps.some(s=>s.name===name&&s.conclusion==='success'),'Missing successful step: '+name);
 verifySecurityV2Results(r.results);
 assert.deepEqual([...r.methods].sort(),SECURITY_V2_TARGETS.map(t=>t.key).sort());
 assert.deepEqual(Object.keys(r.methodPins).sort(),[...r.methods].sort());assert.deepEqual(Object.keys(r.holds).sort(),[...r.methods].sort());
 for(const key of r.methods){
  const t=securityV2Target(key),hold=r.holds[key];
  assert.equal(hold.status,'GAP');assert.equal(hold.testedBy,null);assert.equal(hold.reviewedUncertified.kind,SECURITY_V2_HOLD_KIND);
  assert.equal(hold.reviewedUncertified.coverageCredits,0);
  const pins={...r.globalPins,...r.methodPins[key]};
  for(const f of [t.path,t.proof,t.contract,...SECURITY_V2_FAMILY_ROOTS])assert.match(pins[f]??'',SHA40,'Unpinned input '+f+' for '+key);
  // The original proof must be the file that ran: same blob as the archived credit, so its line anchors still hold.
  assert.equal(pins[t.proof],hold.reviewedUncertified.previousMethodProof.proofBlobSha,'Proof file changed since the archived credit: '+t.proof);
  assert.equal(pins[t.path],hold.reviewedUncertified.routeBlobSha);
 }
 return r;
}

export function readSecurityV2Receipt(read=readFileSync){
 assert.match(SECURITY_V2_RECEIPT_BLOB,SHA40,'Fresh security-write receipt has not been sealed; no credit');
 const raw=read(SECURITY_V2_RECEIPT);assert.equal(blob(raw),SECURITY_V2_RECEIPT_BLOB,'Fresh security-write receipt changed');
 return validateSecurityV2Receipt(JSON.parse(raw));
}

/** Files of the method's own closure or the global base whose current bytes differ from the sealed execution. */
export function securityV2Drift(receipt,key,read=readFileSync){
 assert.ok(receipt.methodPins[key],'No sealed closure for '+key);
 const pins={...receipt.globalPins,...receipt.methodPins[key]};
 return Object.entries(pins).filter(([file,sha])=>{
  let current;try{current=read(file);}catch(error){if(error.code==='ENOENT')return true;throw error;}
  return blob(current)!==sha;
 }).map(([file])=>file).sort();
}

export function securityV2Row(key,receipt){
 const t=securityV2Target(key),hold=receipt.holds[key],old=hold.reviewedUncertified.previousMethodProof,pins={...receipt.globalPins,...receipt.methodPins[key]};
 const anchors=Object.fromEntries(Object.entries(old).filter(([k])=>k==='file'||k==='line'||k.endsWith('Line')));
 const {reviewedUncertified:_dropped,...rest}=hold;
 return {...rest,status:'COVERED',
  reason:'SOLO_VERIFIED_DEV_RECOVERY: complete source-current two-attacker fictional PG16 production-HTTP proof bound to this method\'s own executed closure. '+
   old.boundary+' Independent security review PENDING; no production certification.',
  testedBy:{kind:SECURITY_V2_KIND,method:key,...anchors,routeBlobSha:pins[t.path],proofBlobSha:pins[t.proof],
   receiptFile:SECURITY_V2_RECEIPT,receiptBlobSha:SECURITY_V2_RECEIPT_BLOB,testedHead:receipt.execution.testedHead,
   testedMerge:receipt.execution.testedMerge,runId:receipt.execution.runId,workflowJobIds:[receipt.execution.jobId],
   evidence:receipt.execution.evidence,label:receipt.label,postgresMajor:16,independentSecurityReview:'PENDING',productionTested:false,
   boundary:old.boundary}};
}

const routeMethod=(manifest,t)=>manifest.allApiRouteFiles[t.path]?.methods.find(m=>m.name===t.verb);
export const isSecurityV2Row=row=>row?.testedBy?.kind===SECURITY_V2_KIND;
export const hasSecurityV2Promotions=manifest=>SECURITY_V2_TARGETS.some(t=>isSecurityV2Row(routeMethod(manifest,t)));
const rowsOf=manifest=>SECURITY_V2_TARGETS.map(t=>({t,row:routeMethod(manifest,t)})).filter(({row})=>isSecurityV2Row(row));

/** Every promoted row must be exactly the sealed row, with a route identical to the sealed one and a current closure. */
export function verifySecurityV2Rows(manifest,read=readFileSync){
 const rows=rowsOf(manifest);if(!rows.length)return new Set();
 const receipt=readSecurityV2Receipt(read),keys=new Set(),drifted=[];
 for(const {t,row} of rows){
  assert.equal(manifest.allApiRouteFiles[t.path].gitBlobSha,receipt.methodPins[t.key][t.path],'Never modify route identity to keep a credit');
  assert.deepEqual(row,securityV2Row(t.key,receipt),'Renewed security-write method metadata/provenance changed');
  const drift=securityV2Drift(receipt,t.key,read);if(drift.length)drifted.push(t.key+' <- '+drift.join(', '));
  keys.add(t.key);
 }
 assert.equal(drifted.length,0,'Security-write v2 source drift; withdraw exactly these methods with '+
  '`node scripts/qa/security-write-v2-credit.mjs --withdraw-drifted` (zero credit):\n'+drifted.join('\n'));
 return keys;
}

/** Net new credits this manifest holds over its base: every promoted row must verify, and its base row must be the
 * exact captured hold (a new promotion) or the same promoted row. Anything else is not a sanctioned renewal. */
export function securityV2RenewalDelta(before,after,read=readFileSync){
 const rows=rowsOf(after);if(!rows.length)return 0;
 verifySecurityV2Rows(after,read);const receipt=readSecurityV2Receipt(read);let fresh=0;
 for(const {t,row} of rows){
  const old=routeMethod(before,t);
  if(isSecurityV2Row(old)){assert.deepEqual(old,row,'A promoted security-write row cannot change');continue;}
  assert.deepEqual(old,receipt.holds[t.key],'A security-write credit may only replace its exact captured hold: '+t.key);fresh++;
 }
 return fresh;
}
export const securityV2PromotedCount=manifest=>rowsOf(manifest).length;

/** Strict projection: every verified promoted row returns to its exact captured zero-credit hold. Never HTTP acceptance. */
export function securityV2HoldView(manifest,read=readFileSync){
 const rows=rowsOf(manifest);if(!rows.length)return manifest;
 verifySecurityV2Rows(manifest,read);
 const receipt=readSecurityV2Receipt(read),view=structuredClone(manifest);
 for(const {t} of rows){
  const file=view.allApiRouteFiles[t.path];file.methods[file.methods.findIndex(m=>m.name===t.verb)]=structuredClone(receipt.holds[t.key]);
 }
 view.metrics.coveredAfter-=rows.length;view.metrics.gap+=rows.length;
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 return view;
}

const retally=m=>{
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
};

/** Promote the held rows from the sealed receipt. Pure: returns the next manifest and the promoted keys. */
export function creditSecurityV2(manifest,read=readFileSync){
 const receipt=readSecurityV2Receipt(read),next=structuredClone(manifest),promoted=[];
 for(const key of receipt.methods){
  const t=securityV2Target(key),file=next.allApiRouteFiles[t.path],i=file.methods.findIndex(m=>m.name===t.verb),row=file.methods[i];
  if(isSecurityV2Row(row)){assert.deepEqual(row,securityV2Row(key,receipt),'Existing security-write v2 row changed');continue;}
  assert.deepEqual(row,receipt.holds[key],'Only the exact captured hold may be promoted: '+key);
  assert.equal(file.gitBlobSha,receipt.methodPins[key][t.path]);
  assert.deepEqual(securityV2Drift(receipt,key,read),[],'Closure drifted before credit: '+key);
  file.methods[i]=securityV2Row(key,receipt);promoted.push(key);
 }
 retally(next);return {manifest:next,promoted};
}

/** The only sanctioned demotion: rows whose own closure or the global base drifted go back to the captured hold. */
export function withdrawDriftedSecurityV2(manifest,read=readFileSync){
 const rows=rowsOf(manifest);if(!rows.length)return {manifest,withdrawn:[]};
 const receipt=readSecurityV2Receipt(read),next=structuredClone(manifest),withdrawn=[];
 for(const {t,row} of rows){
  assert.deepEqual(row,securityV2Row(t.key,receipt),'Renewed security-write method metadata/provenance changed');
  if(!securityV2Drift(receipt,t.key,read).length)continue;
  const file=next.allApiRouteFiles[t.path];file.methods[file.methods.findIndex(m=>m.name===t.verb)]=structuredClone(receipt.holds[t.key]);withdrawn.push(t.key);
 }
 retally(next);return {manifest:next,withdrawn};
}

const PLAN='docs/engineering/tenant-isolation-closure-plan.md',OVERVIEW='docs/engineering/tenant-isolation-coverage-inventory.md';
const PROOF_CELL='[Security-write v2 PG16 proof](../../scripts/qa/security-write-v2-receipt.json)';
/** Keeps the two ledger documents in step with the manifest (method rows, headline counts and batch tables). */
export async function syncSecurityV2Docs(manifest,read=readFileSync){
 const {regeneratedOverview,regeneratedClosure}=await import('./tenant-mkt01-marketing-credit.mjs');
 const {reconcilePlan}=await import('./payroll-run-credit-renewal.mjs');
 const overview=read(OVERVIEW,'utf8').split('\n').map(line=>{
  for(const t of SECURITY_V2_TARGETS){
   const short=t.path.slice('src/app/api/'.length,-'/route.ts'.length);
   if(!line.startsWith('| [`'+short+'` '+t.verb+']'))continue;
   const status=routeMethod(manifest,t).status,cells=line.split(' | ');
   cells[cells.length-2]=status==='COVERED'?PROOF_CELL:'NO VALID METHOD PROOF';cells[cells.length-1]='**'+status+'** |';
   return cells.join(' | ');
  }
  return line;
 }).join('\n');
 return [[OVERVIEW,regeneratedOverview(overview,manifest)],[PLAN,regeneratedClosure(reconcilePlan(read(PLAN,'utf8'),manifest),manifest)]];
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv[2],manifest=JSON.parse(readFileSync(SECURITY_V2_MANIFEST,'utf8'));
 assert.ok(['--check','--credit','--withdraw-drifted'].includes(mode)&&process.argv.length===3,'Usage: --check | --credit | --withdraw-drifted');
 if(mode==='--check')console.log(JSON.stringify({verified:[...verifySecurityV2Rows(manifest)],write:false}));
 else{
  const {manifest:next,promoted,withdrawn}=mode==='--credit'?creditSecurityV2(manifest):withdrawDriftedSecurityV2(manifest);
  const changed=JSON.stringify(next)!==JSON.stringify(manifest);
  if(changed){writeFileSync(SECURITY_V2_MANIFEST,JSON.stringify(next,null,2)+'\n');for(const [file,text]of await syncSecurityV2Docs(next))writeFileSync(file,text);}
  console.log(JSON.stringify({covered:next.metrics.coveredAfter,gap:next.metrics.gap,promoted:promoted??[],withdrawn:withdrawn??[],wrote:changed}));
 }
}
