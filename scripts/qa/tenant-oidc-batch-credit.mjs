/** Exactly two protocol-method promotions from inspected real HTTPS/PG16 evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const OIDC_START='src/app/api/auth/sso/start/route.ts';
export const OIDC_BATCH_CALLBACK='src/app/api/auth/sso/callback/route.ts';
export const OIDC_BATCH_RECEIPT='scripts/qa/tenant-oidc-batch-executed-receipt.json';
const TARGETS=[OIDC_START,OIDC_BATCH_CALLBACK],HARNESS='scripts/qa/tenant-oidc-batch-http.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md',PLAN='docs/engineering/tenant-isolation-closure-plan.md';
const blob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex');
export function readOidcBatchExecution(read=readFileSync,list=readdirSync){
 const raw=read(OIDC_BATCH_RECEIPT);
 assert.equal(createHash('sha256').update(raw).digest('hex'),'6e0a86bff2cd77c080b7aef4f303eddfe3221b618f0ea870ebff40b96bed01fe','Executed OIDC batch receipt changed');
 const r=JSON.parse(raw);assert.equal(r.schema,'oidc-start-callback-executed-pg16-v1');
 assert.equal(r.sourceCommit,'92309ae90163d8e2fdd8a0578cb20933ae8730d3');
 assert.equal(r.workflowRunId,43553920124);assert.equal(r.workflowJobId,132322353286);assert.equal(r.jobConclusion,'success');
 assert.equal(r.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/43553920124/job/132322353286');
 assert.equal(r.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(Object.keys(r.inputs).length,214);
 for(const[file,sha]of Object.entries(r.inputs))assert.equal(blob(read(file)),sha,'OIDC batch executed input drift: '+file);
 const expected=Object.keys(r.inputs).filter(p=>/^drizzle\/\d{4}_.+\.sql$/.test(p)).sort();
 const actual=list('drizzle').filter(p=>/^\d{4}_.+\.sql$/.test(p)).map(p=>'drizzle/'+p).sort();
 assert.deepEqual(actual,expected,'OIDC batch baseline SQL inventory changed; renew the real proof');
 const p=r.proof;assert.equal(p.sourceCommit,r.sourceCommit);
 assert.deepEqual(p.methods,['GET auth/sso/start','GET auth/sso/callback']);
 assert.deepEqual([p.ownStartControls,p.validatedStarts,p.startDenials,p.malformedStartDenials,p.ownLogins,
  p.refusedCallbacks,p.authenticatedForeignReadsDenied,p.offRefusals],[3,47,4,16,2,43,2,9]);
 for(const k of ['victimOwnLogin','realPkce','realRsaJwks','tlsVerificationEnabled','ssrfGuardUnchanged',
  'onlyLocallyRoutedSyntheticIdp','resolveCreditHeldByOwner'])assert.equal(p[k],true,k);
 for(const k of ['transportMocks','productionCertified'])assert.equal(p[k],false,k);
 assert.equal(p.coverageCredits,0);assert.equal(p.realProviderCalls,0);
 assert.equal(p.independentSecurityReview,'PENDING');assert.equal(p.evidenceClassification,'SOLO_VERIFIED_DEV_RECOVERY');
 return r;
}
export function expectedOidcBatchProof(path,read=readFileSync){
 assert.ok(TARGETS.includes(path));const r=readOidcBatchExecution(read),start=path===OIDC_START;
 const anchors=start?{
  line:'const expectedRedirect=assertOwnedOidcStart(start,e)',ownPositiveLine:'const expectedRedirect=assertOwnedOidcStart(start,e)',
  foreignDenialLine:'assertDeniedOidcStart(refused,403',unchangedDbLine:'Own start changed protected victim SQL',
  forgedSelectorLine:"'&organizationId='+other.org.id+'&userId='+other.owner.id",discriminationLine:'assert.equal(row.providerId,e.provider.id)',
 }:{
  line:'Own callback must authenticate:',ownPositiveLine:'Own callback must authenticate:',
  foreignDenialLine:'await reject(victimFlow, 403,',unchangedDbLine:'Denied callback changed victim SQL',
  forgedSelectorLine:'const url = flow.url + "&organizationId="',discriminationLine:'assert.equal(foreign.status, 403); discriminator++',
 };
 const lines=read(HARNESS,'utf8').split('\n'),citations={};
 for(const[k,fragment]of Object.entries(anchors)){
  const matches=lines.flatMap((s,i)=>s.includes(fragment)?[i+1]:[]);assert.equal(matches.length,1,'Lost exact OIDC anchor '+k);citations[k]=matches[0];
 }
 return{kind:'oidc-start-callback-batch-real-https-pg16',method:'GET',routePath:path,file:HARNESS,...citations,
  routeBlobSha:r.inputs[path],proofBlobSha:r.inputs[HARNESS],workflowFile:'.github/workflows/tenant-oidc-batch-http.yml',
  workflowBlobSha:r.inputs['.github/workflows/tenant-oidc-batch-http.yml'],sourceHead:r.sourceCommit,
  workflowRunId:r.workflowRunId,workflowJobId:r.workflowJobId,evidence:r.evidence,
  evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,independentlyAccepted:false,
  independentSecurityReview:'PENDING',productionCertified:false,
  scope:start?'Verified email-domain/provider/browser-state initiation, not account authentication or private provider discovery':
   'Real RSA/JWKS/TLS/PKCE own authentication, browser/victim/claims refusal and unchanged protected identity SQL'};
}
export function verifyOidcBatchMethod(m,path,read=readFileSync){
 const expected=expectedOidcBatchProof(path,read),entry=m.allApiRouteFiles[path],row=entry?.methods.find(x=>x.name==='GET');
 assert.equal(entry.gitBlobSha,expected.routeBlobSha);assert.equal(row.status,'COVERED');
 assert.equal(row.reviewedUncertified,undefined);assert.deepEqual(row.testedBy,expected,'An OIDC method cannot borrow another protocol step or historical receipt');
 const priorSha=path===OIDC_START?'9c89b46b5895fc7717bc6ad66b0eed92acbf09ff3b3e077c19667e748c54f6bb':'49db0012b0ed94044ecd2d27e47b4ddad1d9e5db84b5bd012d455c279bdfe4f3';
 assert.equal(createHash('sha256').update(JSON.stringify(row.historicalOidcSourceWithdrawal)).digest('hex'),priorSha,'Original OIDC GAP history changed');
 const resolve=m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods.find(x=>x.name==='POST');
 assert.equal(resolve.status,'GAP','Owner explicitly held anonymous resolve credit');assert.equal(resolve.testedBy,null);
 return 1;
}
export function verifyOidcBatchCredits(m,read=readFileSync){
 for(const path of TARGETS)verifyOidcBatchMethod(m,path,read);return TARGETS.length;
}
export function oidcStartCreditDelta(before,m,read=readFileSync){
 const prior=before.allApiRouteFiles[OIDC_START].methods.find(x=>x.name==='GET');
 const current=m.allApiRouteFiles[OIDC_START].methods.find(x=>x.name==='GET');
 return prior.status==='GAP'&&current.status==='COVERED'?verifyOidcBatchMethod(m,OIDC_START,read):0;
}
/** Validation-only reconstruction for sealed page/payroll receipts. Never write this view. */
export function historicOidcBatchView(m,read=readFileSync){
 const view=structuredClone(m);
 for(const path of TARGETS){const row=view.allApiRouteFiles[path].methods.find(x=>x.name==='GET');
  if(row.status!=='COVERED')continue;
  verifyOidcBatchMethod(m,path,read);
  Object.assign(row,structuredClone(row.historicalOidcSourceWithdrawal));
  delete row.historicalOidcSourceWithdrawal;
  view.metrics.coveredAfter--;view.metrics.gap++;
 }
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 return view;
}
export async function creditOidcBatch({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST)),before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 const rows=TARGETS.map(path=>m.allApiRouteFiles[path].methods.find(x=>x.name==='GET'));
 if(rows.every(r=>r.status==='COVERED')){verifyOidcBatchCredits(m);await reconcileOidcCreditDocs(write);return{write,before,after:before,newCredits:0};}
 assert.ok(rows.every(r=>r.status==='GAP'&&r.testedBy===null),'Only the complete two-method GAP pair may be promoted');assert.ok(write,'Execute reviewed credit writer first');
 for(const path of TARGETS){const row=m.allApiRouteFiles[path].methods.find(x=>x.name==='GET');
  const prior=structuredClone(row);row.status='COVERED';row.testedBy=expectedOidcBatchProof(path);
  if(row.reviewedUncertified)row.historicalOidcSourceWithdrawal=prior;
  delete row.reviewedUncertified;
  row.reason='Provisional current-source identity protocol proof: '+row.testedBy.scope+'. '+row.testedBy.evidence+'. SOLO_VERIFIED_DEV_RECOVERY; default-OFF deployment, anonymous resolve GAP, independent identity/security/privacy and production acceptance PENDING.';
 }
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 assert.equal(m.metrics.coveredAfter,before.covered+2);assert.equal(m.metrics.gap,before.gap-2);
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods')+
  ' Current-source OIDC start/callback recovery: '+rows[0].testedBy.evidence+'; anonymous resolve remains GAP by owner decision. No production SSO activation.';
 verifyOidcBatchCredits(m);writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
 let inventory=readFileSync(INVENTORY,'utf8');
 for(const path of TARGETS){const route=m.allApiRouteFiles[path].route,lines=inventory.split('\n');
  const at=lines.findIndex(l=>l.startsWith('| [`'+route+'` GET]'));assert.ok(at>=0&&lines[at].includes('**GAP**'));
  lines[at]=lines[at].replace('| NO VALID METHOD PROOF | **GAP** |','| [current HTTPS IdP / PG16]('+rows[0].testedBy.evidence+') | **COVERED** |');
  assert.ok(lines[at].includes('**COVERED**'));inventory=lines.join('\n');
 }
 const prefix='> **SSO DEFAULT-OFF INTEGRATION HOLD (PR #1954, pending review):** ';
 const banner=prefix+'Deployment remains default-OFF. Source-current start and callback proofs provisionally recover two protocol methods; anonymous resolve remains GAP by explicit owner decision. **498 methods = '+m.metrics.coveredAfter+' COVERED / 23 PUBLIC-BY-DESIGN / 12 TOKEN-ONLY / '+m.metrics.gap+' GAP**. Independent identity/privacy/security and production acceptance PENDING.';
 for(const[file,text]of [[INVENTORY,inventory],[PLAN,readFileSync(PLAN,'utf8')]]){
  assert.ok(text.startsWith(prefix));writeFileSync(file,banner+text.slice(text.indexOf('\n')));
 }
 await reconcileOidcCreditDocs(true);
 return{write,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},newCredits:2};
}
async function reconcileOidcCreditDocs(write){
 const {reconcilePayrollRenewal}=await import('./payroll-run-credit-renewal.mjs');
 const {reconcileStudioPostCredit}=await import('./tenant-studio-post-credit.mjs');
 reconcilePayrollRenewal({write});reconcileStudioPostCredit({write});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(['--write','--check'].includes(process.argv[2]));
 // Complete module evaluation before importing historical reconcilers that
 // themselves validate this receipt. Awaiting here would form an ESM cycle.
 creditOidcBatch({write:process.argv[2]==='--write'}).then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{console.error(error);process.exitCode=1;});
}
