/** Current-source zero-credit checks. Never project an archived receipt as live proof. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WAGE_PROOF_SOURCE,PRIOR_WAGE_BLOB_SHA,NEW_WAGE_BLOB_SHA,verifyAllWageRegistrySourceHolds} from './wage-registry-source-hold.mjs';
import {verifyAllTransitiveWageHolds} from './wage-registry-transitive-source-hold.mjs';
import {verifyAllSealedWageHolds} from './wage-registry-sealed-receipt-source-hold.mjs';

const KINDS=new Set(['wage-registry-dependency-source-withdrawal',
  'wage-registry-transitive-dependency-source-withdrawal','wage-registry-global-source-seal-withdrawal']);
export function verifiedWageCreditHolds(manifest,read=readFileSync){
  const raw=Buffer.from(read(WAGE_PROOF_SOURCE));
  const source=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  if(source===PRIOR_WAGE_BLOB_SHA){
    assert.equal(Object.values(manifest.allApiRouteFiles).flatMap(x=>x.methods)
      .filter(x=>KINDS.has(x.reviewedUncertified?.kind)).length,0,'Old source cannot borrow new wage holds');
    return new Set();
  }
  assert.equal(source,NEW_WAGE_BLOB_SHA,'Unreviewed wage source requires a new hold inventory');
  const direct=verifyAllWageRegistrySourceHolds(manifest,read);
  const held=new Set([
    ...direct.map(key=>{const at=key.lastIndexOf(' ');return key.slice(at+1)+' '+key.slice(0,at);}),
    ...verifyAllTransitiveWageHolds(manifest,read),...verifyAllSealedWageHolds(manifest,read),
  ]);
  assert.equal(held.size,75,'All three disjoint wage withdrawal cohorts must remain complete');
  return held;
}

/** Inspect historical citations only after the entire live withdrawal verifies. */
export function wageHeldPriorProof(manifest,path,verb,read=readFileSync){
  const row=manifest.allApiRouteFiles[path]?.methods.find(x=>x.name===verb);
  if(!KINDS.has(row?.reviewedUncertified?.kind))return null;
  assert.ok(verifiedWageCreditHolds(manifest,read).has(verb+' '+path));
  assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
  return structuredClone(row.reviewedUncertified.priorProof);
}
