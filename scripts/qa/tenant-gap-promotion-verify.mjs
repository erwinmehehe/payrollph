import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const pins=JSON.parse(readFileSync(new URL('./tenant-gap-promotion-pins.json',import.meta.url),'utf8'));
const base='a7dc1f5184f59f3c5ac348e37b4ca88810f10651';
// This fixed catalogue preserves the reviewed route identities, exact proof
// anchors and historical workflow receipts. It does not execute HTTP or grant
// acceptance, and must never be extended merely to make a new credit pass.
export function verifyPromotionCredits(manifest, read=path=>readFileSync(path,'utf8')) {
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
