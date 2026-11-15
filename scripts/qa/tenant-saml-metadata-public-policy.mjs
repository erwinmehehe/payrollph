/** One explicit owner decision; historical views never grant execution acceptance. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SAML_METADATA_ROUTE,SAML_METADATA_BLOB,SAML_PRIVACY_HOLD,verifySamlMetadataPrivacyHold} from './tenant-saml-metadata-privacy-verify.mjs';
export const SAML_PUBLIC_PATH=SAML_METADATA_ROUTE;
export const SAML_OWNER_APPROVAL='docs/qa/tenant-saml-metadata-owner-approval.json';
export const SAML_PRIVACY_ARCHIVE='scripts/qa/tenant-saml-metadata-privacy-archive.json';
const blob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex');
const WRAPPERS={
 'tests/tenant-saml-metadata-public.test.mjs':'1cd0fccb248c8c4697e08e0a127c27143ae3ab0f',
 'tests/tenant-saml-metadata-privacy-verify.test.mjs':'bbd1796f51295a69488b695682f55f40a6377ccd',
};
function archive(read){
 const raw=read(SAML_PRIVACY_ARCHIVE);assert.equal(blob(raw),'de43e70e3adf9060cc089eca113e4add758488f0','Historical SAML privacy archive changed');
 const a=JSON.parse(raw);assert.equal(a.schema,'saml-metadata-preclassification-archive-v1');
 for(const[p,text]of Object.entries(a.files))assert.equal(blob(text),SAML_PRIVACY_HOLD.pins[p],'Historical privacy test must retain original bytes');
 return a;
}
export function readSamlOwnerApproval(read=readFileSync){
 const raw=read(SAML_OWNER_APPROVAL);assert.equal(blob(raw),'460a8cdba65eeeb929ca858c44e132b1906bb5ae','SAML owner decision changed');
 const a=JSON.parse(raw);assert.equal(a.status,'APPROVED');assert.equal(a.ownerLogin,'erwinmehehe');
 assert.equal(a.method,'GET');assert.equal(a.route,SAML_METADATA_ROUTE);assert.equal(a.routeBlobSha,SAML_METADATA_BLOB);
 assert.equal(a.classification,'PUBLIC-BY-DESIGN');assert.equal(a.scope.methodsRelabelled,1);assert.equal(a.scope.newCoveredCredits,0);
 assert.equal(a.scope.resolveStatus,'GAP');assert.equal(a.scope.productionActivation,false);
 assert.equal(blob(read(a.reviewedPacket.path)),a.reviewedPacket.gitBlobSha,'Approved public-field packet changed');
 return a;
}
/** Accept only original test bytes or the exact reviewed classification adapters. */
export function samlPrivacyRead(read=readFileSync){
 const a=archive(read);
 return(p,...args)=>{
  const value=read(p,...args);if(!Object.hasOwn(WRAPPERS,p))return value;
  if(blob(value)===SAML_PRIVACY_HOLD.pins[p])return value;
  assert.equal(blob(value),WRAPPERS[p],'SAML privacy adapter source drift: '+p);
  return args[0]?a.files[p]:Buffer.from(a.files[p]);
 };
}
export function expectedSamlPublicMethod(read=readFileSync){
 readSamlOwnerApproval(read);const original=archive(read).method;
 return{name:original.name,line:original.line,status:'PUBLIC-BY-DESIGN',
  reason:'Owner-approved public SAML service-provider XML only: canonical HTTPS origin, enabled provider ID and static protocol attributes. Disabled/OIDC/missing providers concealed. No tenant-private COVERED credit, SAML authentication or production activation; anonymous OIDC resolve remains GAP.',
  testedBy:null,classificationEvidence:{kind:'owner-approved-public-saml-metadata',file:SAML_OWNER_APPROVAL,line:1,
   approvalBlobSha:'460a8cdba65eeeb929ca858c44e132b1906bb5ae',routeBlobSha:SAML_METADATA_BLOB,
   executionReceiptFile:'scripts/qa/tenant-saml-metadata-fresh-executed-receipt.json',
   evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',coverageCredits:0,independentlyAccepted:false,productionCertified:false},
  historicalSourceHold:original};
}
/** Validate shape/decision only; execution is separately mandatory in the classification gate. */
export function verifySamlPublicPolicy(m,read=readFileSync){
 const entry=m.allApiRouteFiles[SAML_METADATA_ROUTE];assert.equal(entry.gitBlobSha,SAML_METADATA_BLOB);
 assert.equal(blob(read(SAML_METADATA_ROUTE)),SAML_METADATA_BLOB);assert.equal(entry.methods.length,1);
 assert.deepEqual(entry.methods[0],expectedSamlPublicMethod(read),'Only the exact approved SAML public contract may be relabelled');
 const resolve=m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods.find(r=>r.name==='POST');
 assert.equal(resolve.status,'GAP','Owner explicitly kept anonymous resolve held');assert.equal(resolve.testedBy,null);
 return 1;
}
/** Validation-only reconstruction of the original GAP for sealed historical guards. */
export function historicalSamlMetadataView(m,read=readFileSync){
 const view=structuredClone(m),entry=view.allApiRouteFiles[SAML_METADATA_ROUTE];
 if(entry.methods[0].status==='PUBLIC-BY-DESIGN'){
  verifySamlPublicPolicy(m,read);entry.methods=[structuredClone(archive(read).method)];
  view.metrics.publicByDesign--;view.metrics.gap++;
  view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 }
 assert.equal(verifySamlMetadataPrivacyHold(view,samlPrivacyRead(read)),0);
 return view;
}
