import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const pins=JSON.parse(readFileSync(new URL('./tenant-gap-promotion-pins.json',import.meta.url),'utf8'));
const base='a7dc1f5184f59f3c5ac348e37b4ca88810f10651';
// Restore only the historical journal receipt for catalogue inspection.
export function historicalJournalPromotionView(manifest) {
 const path='src/app/api/v1/journal-entries/route.ts';
 const current=manifest.allApiRouteFiles[path];
 if(current?.methods[0]?.reviewedUncertified?.kind!=='philhealth-journal-source-hold')return manifest;
 const archive=JSON.parse(readFileSync(new URL('./philhealth-journal-source-hold.json',import.meta.url)));
 assert.deepEqual(current,archive.records[path]);
 const view=structuredClone(manifest);
 const row=view.allApiRouteFiles[path].methods[0];
 row.status='COVERED';
 row.testedBy=row.reviewedUncertified.previousMethodProof;
 return view;
}
// This fixed catalogue preserves the reviewed route identities, exact proof
// anchors and historical workflow receipts. It does not execute HTTP or grant
// acceptance, and must never be extended merely to make a new credit pass.
export function readPromotionSource(path) {
 return readFileSync(path==='scripts/qa/tenant-v1-journal-http.mjs'
  ? 'tests/fixtures/tenant-v1-journal-1484.mjs.txt' : path,'utf8');
}
export function verifyPromotionCredits(manifest, read=readPromotionSource) {
 manifest=historicalJournalPromotionView(manifest);
 const actual=Object.values(manifest.allApiRouteFiles).flatMap(r=>r.methods
  .filter(m=>m.testedBy?.verifiedMainCommit===base)
  .map(m=>({key:m.name+' '+r.route,method:m})));
 assert.equal(pins.records.length,16);
 assert.deepEqual(actual.map(r=>r.key).sort(),pins.records.map(r=>r.key).sort(),'unsupported promotion identity');
 for(const [file,hash] of Object.entries(pins.hashes)) {
  const source=read(file).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),hash,'promotion proof source drift: '+file);
 }
 for(const {key,proof} of pins.records) {
  const method=actual.find(r=>r.key===key).method;
  assert.equal(method.status,'COVERED',key);
  assert.deepEqual(method.testedBy,proof,'promotion evidence changed: '+key);
  const lines=read(proof.file).split('\n');
  for(const field of ['ownPositiveLine','foreignDenialLine','forgedSelectorLine','unchangedDbLine'])
   assert.ok(Number.isSafeInteger(proof[field])&&lines[proof[field]-1]?.trim(),'missing promotion anchor: '+key+' '+field);
 }
 return actual.length;
}
