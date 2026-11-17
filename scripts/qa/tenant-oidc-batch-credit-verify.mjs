/** Exactly two protocol-method promotions from inspected real HTTPS/PG16 evidence. */
import assert from 'node:assert/strict';
import {SSO_RESOLVE_PATH,historicalSsoResolveView,assertSsoResolveHeldOrApproved} from './tenant-sso-resolve-public-policy.mjs';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {historicalSamlMetadataView,SAML_PUBLIC_PATH} from './tenant-saml-metadata-public-policy.mjs';
import {historicWageRegistryProofView} from './wage-registry-source-hold.mjs';
export const OIDC_START='src/app/api/auth/sso/start/route.ts';
export const OIDC_BATCH_CALLBACK='src/app/api/auth/sso/callback/route.ts';
export const OIDC_BATCH_RECEIPT='scripts/qa/tenant-oidc-batch-executed-receipt.json';
const TARGETS=[OIDC_START,OIDC_BATCH_CALLBACK],HARNESS='scripts/qa/tenant-oidc-batch-http.mjs';
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
 assertSsoResolveHeldOrApproved(m,read);assert.equal(resolve.testedBy,null);
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
/**
 * Rewind ONLY the exact, source-bound private-document GET zero-credit hold
 * when re-running older five/six/four-page proof generators. Those generators
 * predate this new legal-employer source and therefore expect the old GET proof
 * in their HISTORICAL counting view. Live manifest GAP and old receipts remain
 * unchanged. Rewind rejects altered grant guards, modified proof contracts,
 * forged proof credits or unrelated method downgrades.
 */
export function historicalDocumentGetView(input, read = readFileSync) {
 const path = "src/app/api/documents/[id]/route.ts";
 const oldSha = "0acb38b1396b1e35adf02efd6e033cdd0416e0d0";
 const newSha = "7ec01fa9698db169e75569617aca825571842e7c";
 const row = input.allApiRouteFiles?.[path];
 const method = row?.methods?.find(m => m.name === "GET");
 const hold = method?.reviewedUncertified;
 if (hold?.kind !== "document-download-multi-entity-legal-employer-source-change-zero-credit")
   return input;
 const expectedProof = {
  file: "scripts/qa/tenant-second-pass-http.mjs",
  line: 950, ownPositiveLine: 840, foreignDenialLine: 950,
  scope: "Actual CI PostgreSQL, victim and two independent attacker employers; role and same-tenant coworker tests where applicable",
 };
 const priorReason =
  "Real own clean attachment bytes HTTP 200, victim-only high document ID download and inline 403 for both attackers; read never changes victim document";
 const priorRevision = {
  kind:"tenant-private-document-active-membership-prefilter-review-only",
  oldRouteBlobSha:"e4decf0b28ff6d0f070d7ee0e5027255590bb816",
  newRouteBlobSha:oldSha,
  sourceContractTest:"tests/tenant-private-document-id-boundary.test.mjs",
  currentHeadAuthenticatedPg16Http:"PENDING",
  independentSecurityReview:"PENDING",
  productionCertified:false,
  noNewMethodCredit:true,
 };
 assert.equal(row?.gitBlobSha,newSha,"DOC_HISTORICAL_REFUSED: current route SHA changed");
 assert.equal(row.methods?.length,1,"DOC_HISTORICAL_REFUSED: changed method inventory");
 assert.equal(method.status,"GAP","DOC_HISTORICAL_REFUSED: current method must retain GAP");
 assert.equal(method.testedBy,null,"DOC_HISTORICAL_REFUSED: unexecuted credit must be absent");
 assert.deepEqual(hold.previousMethodProof,expectedProof,"DOC_HISTORICAL_REFUSED: prior sealed receipt changed");
 assert.equal(hold.previousRouteBlobSha,oldSha);
 assert.equal(hold.routeBlobSha,newSha);
 assert.equal(hold.sourceContractTest,"tests/tenant-private-document-id-boundary.test.mjs");
 assert.equal(hold.coverageCredits,0);
 assert.equal(hold.exactHeadPg16Http,"PENDING");
 assert.equal(hold.independentSecurityReview,"PENDING");
 assert.equal(hold.productionCertified,false);
 assert.equal(row.sourceRevisionReview?.kind,
  "document-download-legal-employer-grant-source-revision-zero-credit");
 assert.equal(row.sourceRevisionReview?.oldRouteBlobSha,oldSha);
 assert.equal(row.sourceRevisionReview?.newRouteBlobSha,newSha);
 assert.equal(row.sourceRevisionReview?.noNewMethodCredit,true);
 assert.deepEqual(row.sourceRevisionReview?.priorActiveMembershipRevision,priorRevision,
  "DOC_HISTORICAL_REFUSED: original source review modified");
 assert.ok(method.reason?.startsWith("REVIEW-ONLY SOURCE HOLD:"),
  "DOC_HISTORICAL_REFUSED: current hold has no reviewed reason");
 assert.equal(blob(read(path)),newSha,"DOC_HISTORICAL_REFUSED: changed live authorization guard");
 assert.equal(blob(read(hold.sourceContractTest)),
  "f4564a5e0a6a8afa7657c04789f464077ee46e50",
  "DOC_HISTORICAL_REFUSED: original source contract changed");
 const actual = Object.values(input.allApiRouteFiles).flatMap(file => file.methods);
 assert.equal(input.metrics.methods,actual.length);
 assert.equal(input.metrics.gap,actual.filter(m => m.status === "GAP").length,
  "DOC_HISTORICAL_REFUSED: live GAP tally changed");
 assert.equal(input.metrics.coveredAfter,actual.filter(m => m.status === "COVERED").length,
  "DOC_HISTORICAL_REFUSED: live covered tally changed");
 const view = structuredClone(input);
 const projected = view.allApiRouteFiles[path];
 const old = projected.methods[0];
 projected.gitBlobSha=oldSha;
 old.status="COVERED";
 old.reason=priorReason;
 old.testedBy=structuredClone(expectedProof);
 delete old.reviewedUncertified;
 projected.sourceRevisionReview=structuredClone(priorRevision);
 view.metrics.coveredAfter++;
 view.metrics.gap--;
 view.acceptanceStatus=view.acceptanceStatus.replace(
  /^NOT ACCEPTED: \d+ API methods/,
  "NOT ACCEPTED: "+view.metrics.gap+" API methods");
 return view;
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
 // Keep page/payroll historical API counts separate from this later,
 // explicitly approved public classification. No OIDC credit is added.
 // Each later, separately approved public label is reversed only after its own exact owner policy verifies.
 let historic=view;
 if(historic.allApiRouteFiles[SAML_PUBLIC_PATH]?.methods[0]?.status==='PUBLIC-BY-DESIGN')historic=historicalSamlMetadataView(historic,read);
 if(historic.allApiRouteFiles[SSO_RESOLVE_PATH]?.methods[0]?.status==='PUBLIC-BY-DESIGN')historic=historicalSsoResolveView(historic,read);
  // Every affected wage-source claim stays held in the live ledger; this is
  // solely a source-verified in-memory projection of the older page receipt.
  return historicalDocumentGetView(historicWageRegistryProofView(historic,read),read);
}
