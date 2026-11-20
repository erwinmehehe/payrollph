/** Current-source zero-credit checks. Never project an archived receipt as live proof. */
import assert from 'node:assert/strict';
import {wageRenewalHoldView,WAGE_RENEWAL_KIND} from './wage-registry-renewal-verify.mjs';
import {WAGE_RENEWAL_V2_KIND} from './wage-registry-renewal-v2.mjs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WAGE_PROOF_SOURCE,WATCH_PROOF_SOURCE,PRIOR_WAGE_BLOB_SHA,PRIOR_WATCH_BLOB_SHA,NEW_WAGE_BLOB_SHA,verifyAllWageRegistrySourceHolds} from './wage-registry-source-hold.mjs';
import {verifyAllTransitiveWageHolds} from './wage-registry-transitive-source-hold.mjs';
import {verifyAllSealedWageHolds} from './wage-registry-sealed-receipt-source-hold.mjs';

const KINDS=new Set(['wage-registry-dependency-source-withdrawal',
  'wage-registry-transitive-dependency-source-withdrawal','wage-registry-global-source-seal-withdrawal']);
export function verifiedWageCreditHolds(manifest,read=readFileSync){
  const live=manifest;manifest=wageRenewalHoldView(manifest,read);
  const raw=Buffer.from(read(WAGE_PROOF_SOURCE));
  const source=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  if(source===PRIOR_WAGE_BLOB_SHA){
    const watch=Buffer.from(read(WATCH_PROOF_SOURCE));
    assert.equal(createHash('sha1').update('blob '+watch.length+'\0').update(watch).digest('hex'),
      PRIOR_WATCH_BLOB_SHA,'Old wage source cannot conceal a changed statutory watch');
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
  return new Set([...held].filter(key=>{const at=key.indexOf(' ');return live.allApiRouteFiles[key.slice(at+1)].methods.find(row=>row.name===key.slice(0,at)).status==='GAP';}));
}

/** Generic table reconciliation must preserve newly source-sealed owners too. */
export function protectedWageCreditKeys(manifest,read=readFileSync){
 const held=verifiedWageCreditHolds(manifest,read);
 for(const [path,file]of Object.entries(manifest.allApiRouteFiles))for(const row of file.methods)
  if(row.testedBy?.kind===WAGE_RENEWAL_KIND||row.testedBy?.kind===WAGE_RENEWAL_V2_KIND)held.add(row.name+' '+path);
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
