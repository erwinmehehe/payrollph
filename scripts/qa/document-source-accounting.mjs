/** Exact zero-credit source withdrawals, not HTTP acceptance or fresh credits. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {archivedSeparationPromotion,hasSeparationPromotions,separationDependencyChanged,separationRoute,verifySeparationRenewal} from './separation-pg16-credit.mjs';
export const DOCUMENT_ACCOUNTING_ARCHIVE='scripts/qa/document-source-accounting-archive.json';
export const DOCUMENT_ACCOUNTING_BLOB='b3ccc93613bce6b9ee6ec3dd32b074f7a7befa13';
const blob=b=>{const raw=Buffer.from(b);return createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');};
// Exact source-only refresh for the historical-document metadata privacy repair.
// The immutable archive stays untouched and every GET/POST row remains GAP.
const HISTORIC_LIST_PATH='src/app/api/documents/route.ts';
const HISTORIC_LIST_PRIOR='fb0d1748dd25c6dd985894b9042f7eab427ce898';
const HISTORIC_LIST_CURRENT='ad7d168d50cf2dbba1e20c3e4b05d298b66afc02';
function reviewedHistoricalDocumentListRefresh(path,expected,live,read=readFileSync){
 if(path!==HISTORIC_LIST_PATH||expected?.gitBlobSha!==HISTORIC_LIST_PRIOR||
   live?.gitBlobSha!==HISTORIC_LIST_CURRENT)return false;
 if(blob(read(path))!==HISTORIC_LIST_CURRENT)return false;
 if(live.methods?.length!==2||live.methods.some(m=>
   m.status!=='GAP'||m.testedBy!==null||
   m.reviewedUncertified?.coverageCredits!==0||
   m.reviewedUncertified?.routeBlobSha!==HISTORIC_LIST_CURRENT))return false;
 if(live.sourceRevisionReview?.newRouteBlobSha!==HISTORIC_LIST_CURRENT)return false;
 const prior=structuredClone(live);
 prior.gitBlobSha=HISTORIC_LIST_PRIOR;
 prior.methods.forEach(m=>{m.reviewedUncertified.routeBlobSha=HISTORIC_LIST_PRIOR});
 prior.sourceRevisionReview.newRouteBlobSha=HISTORIC_LIST_PRIOR;
 return JSON.stringify(prior)===JSON.stringify(expected);
}
/**
 * The only source-only historical-document list refresh accepted by older
 * proof-ledger guards. Compare the complete base route record with the sealed
 * archive, then require the exact new source, both GAPs and zero credits.
 */
export function isReviewedHistoricalDocumentListRefresh(path,before,after,read=readFileSync){
 if(path!==HISTORIC_LIST_PATH)return false;
 const archive=sourceHoldArchive(read);
 const metadata=archive.variants.find(variant=>variant.name==='metadata');
 const expected=metadata?.records[path];
 return Boolean(expected&&JSON.stringify(before)===JSON.stringify(expected)&&
  reviewedHistoricalDocumentListRefresh(path,expected,after,read));
}
const activeVariant=(manifest,variant)=>(variant.triggerPaths??Object.keys(variant.records)).some(path=>{
 const expected=variant.records[path],file=manifest.allApiRouteFiles[path];
 return file?.gitBlobSha===expected.gitBlobSha||file?.methods.some(row=>
  expected.methods.some(old=>old.reviewedUncertified&&row.reviewedUncertified?.kind===old.reviewedUncertified.kind));
});
export function sourceHoldArchive(read=readFileSync){
 const raw=read(DOCUMENT_ACCOUNTING_ARCHIVE);
 assert.equal(blob(raw),DOCUMENT_ACCOUNTING_BLOB,'Document accounting archive changed');
 const archive=JSON.parse(raw);
 assert.equal(archive.kind,'exact-document-source-withdrawals-accounting-only');
 const separation=read('scripts/qa/phase25-separation-hold.json');
 assert.equal(blob(separation),'005664e68e44abf709ae85ade1e5aee334a01fda','Phase 25 separation hold archive changed');
 archive.variants.push(JSON.parse(separation));
 return archive;
}
export function reviewedDocumentSourceHoldCount(manifest,read=readFileSync){
 const archive=sourceHoldArchive(read);
 let count=0;
 for(const variant of archive.variants){
  if(variant.name==='phase25-separation'&&hasSeparationPromotions(manifest.allApiRouteFiles[separationRoute])){
   verifySeparationRenewal(manifest,read);
   continue;
  }
  const active=activeVariant(manifest,variant);
  if(!active)continue;
  for(const [path,expected]of Object.entries(variant.records)){
   const file=manifest.allApiRouteFiles[path];
   assert.ok(file,'Document source hold cannot omit a route');
   if(!reviewedHistoricalDocumentListRefresh(path,expected,file,read))
    assert.deepEqual(file,expected,'Only exact archived zero-credit document holds may alter historical gap accounting');
   for(const row of file.methods){
    if(row.status!=='GAP')continue; // Exact archived sibling credits stay unchanged.
    assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
    assert.equal(row.reviewedUncertified.coverageCredits,0);
    count++;
   }
  }
  for(const [path,pin]of Object.entries(variant.sourcePins)){
   const refresh=reviewedHistoricalDocumentListRefresh(path,variant.records[path],
     manifest.allApiRouteFiles[path],read);
   assert.equal(blob(read(path)),refresh?HISTORIC_LIST_CURRENT:pin,
     'Document withdrawal requires exact current route/contract source: '+path);
  }
 }
 return count;
}
/** Source-exact demotions only; inherited holds are not counted twice. */
export function reviewedDocumentSourceWithdrawals(before,after,read=readFileSync){
 reviewedDocumentSourceHoldCount(after,read);
 const archive=sourceHoldArchive(read),keys=new Set();
 for(const variant of archive.variants){
  if(variant.name==='phase25-separation'&&hasSeparationPromotions(after.allApiRouteFiles[separationRoute]))continue;
  if(!activeVariant(after,variant))continue;
  for(const [path,expected]of Object.entries(variant.records)){
  const file=after.allApiRouteFiles[path];
  if(file?.gitBlobSha!==expected.gitBlobSha)continue;
  const prior=before.allApiRouteFiles[path];assert.ok(prior);
  if(variant.name==='phase25-separation'&&hasSeparationPromotions(prior)){
   assert.deepEqual(prior,archivedSeparationPromotion(read),'Only the exact sealed prior separation promotion can enter reproof');
   assert.ok(separationDependencyChanged(read),'The separation dependency hold requires a changed lockfile');
   for(const row of file.methods)keys.add(row.name+' '+path);
   continue;
  }
  assert.deepEqual(prior.methods.map(row=>row.name),file.methods.map(row=>row.name));
  for(const row of file.methods){
   const old=prior.methods.find(item=>item.name===row.name),hold=row.reviewedUncertified;
   if(row.status!=='GAP'){assert.deepEqual(row,old,'Sibling credits must remain exact');continue;}
   if(old.status==='GAP'){
    if(isPhase34SeparationHoldRefresh(path,prior,file))continue;
    assert.deepEqual(prior,file,'Inherited document withdrawal must stay exact');
    continue;
   }
   assert.equal(old.status,'COVERED');
   assert.equal(prior.gitBlobSha,hold.previousRouteBlobSha);
   assert.deepEqual(old.testedBy,hold.previousMethodProof,'Archived document proof must equal the inspected base');
   keys.add(row.name+' '+path);
  }
 }
 }
 return keys;
}

// Phase 34 changed only the route blob and its review fingerprint. Both
// ledger records retain the same three zero-credit methods and proof history.
export function isPhase34SeparationHoldRefresh(path,before,after){
 const priorBlob='1d4733144baa72e4828cc40a087dbc0dbab3a77f';
 const nextBlob='8d7f6772cd2cb9298043cd646aa8883242dd5b84';
 if(path!=='src/app/api/separation/route.ts'||before?.gitBlobSha!==priorBlob||after?.gitBlobSha!==nextBlob||
    after.sourceRevisionReview?.currentRouteBlobSha!==nextBlob||
    !after.methods.every(method=>method.status==='GAP'&&method.testedBy===null&&method.reviewedUncertified?.coverageCredits===0))return false;
 const expected={...after,gitBlobSha:priorBlob,sourceRevisionReview:{...after.sourceRevisionReview,currentRouteBlobSha:priorBlob}};
 return JSON.stringify(before)===JSON.stringify(expected);
}

export function protectedDocumentCreditKeys(manifest,read=readFileSync){
 reviewedDocumentSourceHoldCount(manifest,read);
 const archive=sourceHoldArchive(read),keys=new Set();
 for(const variant of archive.variants){
  if(variant.name==='phase25-separation'&&hasSeparationPromotions(manifest.allApiRouteFiles[separationRoute]))continue;
  if(!activeVariant(manifest,variant))continue;
  for(const [path,file]of Object.entries(variant.records))for(const row of file.methods)
   if(row.status==='GAP')keys.add(row.name+' '+path);
 }
 return keys;
}

/** Old citations only, after verifying every exact current zero-credit hold. */
export function historicalDocumentHoldView(manifest,read=readFileSync){
 const keys=protectedDocumentCreditKeys(manifest,read);
 const view=structuredClone(manifest);
 for(const key of keys){
  const at=key.indexOf(' '),verb=key.slice(0,at),path=key.slice(at+1);
  const row=view.allApiRouteFiles[path].methods.find(x=>x.name===verb);
  row.status='COVERED';row.testedBy=structuredClone(row.reviewedUncertified.previousMethodProof);
  delete row.reviewedUncertified;
  row.reason='HISTORICAL VIEW ONLY: source-bound receipt, current method remains GAP.';
 }
 view.metrics.coveredAfter+=keys.size;view.metrics.gap-=keys.size;
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: [0-9]+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 return view;
}

/** An immutable historic receipt fixture, NEVER a source-current credit view. */
export function historicalDocumentSecurityFixture(manifest,read=readFileSync){
 assert.ok(reviewedDocumentSourceHoldCount(manifest,read)>0);
 const archive=JSON.parse(read(DOCUMENT_ACCOUNTING_ARCHIVE));
 const variant=archive.variants.find(v=>v.name==='metadata');
 assert.ok(activeVariant(manifest,variant),'Only the exact metadata withdrawal permits this historical fixture');
 const view=structuredClone(manifest);
 for(const [path,record]of Object.entries(archive.securityBefore))view.allApiRouteFiles[path]=structuredClone(record);
 const path='src/app/api/documents/route.ts',raw=Buffer.from(archive.securityDocumentSource);
 assert.equal(blob(raw),archive.securityBefore[path].gitBlobSha);
 return {manifest:view,read:(file,...args)=>file===path?raw:read(file,...args)};
}
