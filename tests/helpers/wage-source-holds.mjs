import {reviewedDocumentSourceWithdrawals} from "../../scripts/qa/document-source-accounting.mjs";
import {reviewedTimesheetSourceHold} from "../../scripts/qa/timesheet-source-accounting.mjs";
import {wageHeldPriorProof} from '../../scripts/qa/wage-registry-credit-holds.mjs';
import {verifiedWageCreditHolds} from '../../scripts/qa/wage-registry-credit-holds.mjs';
import {historicWageRegistryProofView} from '../../scripts/qa/wage-registry-source-hold.mjs';
import {baseTenantManifest,assertLiveTenantCounts} from './tenant-counts.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {wageRenewalHoldView,verifyWageRenewalMethod,WAGE_RENEWAL_KIND} from '../../scripts/qa/wage-registry-renewal-verify.mjs';
import { reviewedWageRenewalEngineWithdrawal } from '../../scripts/qa/wage-registry-renewal-supersession.mjs';
export {wageHeldPriorProof};

export function historicalWageCatalog(manifest){
  // Only immutable catalogue citations may use this view. Current credit
  // verifiers must keep rejecting the live GAP rows.
  if(!Object.values(manifest.allApiRouteFiles).some(f=>f.methods.some(m=>
    m.reviewedUncertified?.kind?.startsWith('wage-registry-')||m.testedBy?.kind===WAGE_RENEWAL_KIND)))return manifest;
  verifiedWageCreditHolds(manifest);
  return historicWageRegistryProofView(manifest);
}

/** Strict current-ledger alternative to replaying invalidated receipt verifiers. */
export function assertWageLedgerDelta(assert,manifest){
  if(!Object.values(manifest.allApiRouteFiles).some(f=>f.methods.some(m=>
    m.reviewedUncertified?.kind?.startsWith('wage-registry-')||m.testedBy?.kind===WAGE_RENEWAL_KIND)))return false;
  const liveManifest=manifest;
  const renewed=Object.values(manifest.allApiRouteFiles).flatMap(f=>f.methods).filter(m=>m.testedBy?.kind===WAGE_RENEWAL_KIND).length;
  manifest=wageRenewalHoldView(manifest);
  const holds=verifiedWageCreditHolds(manifest),base=baseTenantManifest();
  assert.ok(base,'The wage withdrawal requires an inspectable main manifest');
  const priorLive=base.manifest;
  const otherWithdrawals=new Set([
    ...reviewedDocumentSourceWithdrawals(priorLive,liveManifest),
    ...reviewedTimesheetSourceHold(priorLive,liveManifest),
  ]);
  const revoked=reviewedWageRenewalEngineWithdrawal(priorLive,liveManifest);
  const prior=revoked.size?priorLive:wageRenewalHoldView(priorLive);
  const priorRenewed=Object.values(priorLive.allApiRouteFiles).flatMap(f=>f.methods).filter(m=>m.testedBy?.kind===WAGE_RENEWAL_KIND).length;
  assert.deepEqual(Object.keys(manifest.allApiRouteFiles).sort(),Object.keys(prior.allApiRouteFiles).sort());
  let withdrawn=0;
  for(const [path,file]of Object.entries(manifest.allApiRouteFiles)){
    const previous=prior.allApiRouteFiles[path];
    if(file.methods.length>0&&file.methods.every(row=>otherWithdrawals.has(row.name+" "+path)))continue;
    const currentRoute={...file},previousRoute={...previous};
    delete currentRoute.methods;delete previousRoute.methods;
    assert.deepEqual(currentRoute,previousRoute,'No route or source identity may change: '+path);
    assert.deepEqual(file.methods.map(x=>x.name),previous.methods.map(x=>x.name));
    for(const row of file.methods){
      const old=previous.methods.find(x=>x.name===row.name),key=row.name+' '+path;
      if(otherWithdrawals.has(key))continue;
      if(holds.has(key)){
        if(old.status==='GAP')assert.deepEqual(row,old,'Inherited hold must stay exact: '+key);
        else if(revoked.has(key)) {
          assert.equal(old.testedBy?.kind,WAGE_RENEWAL_KIND);
          withdrawn++;
        }
        else{
          assert.equal(old.status,'COVERED');
          assert.deepEqual(row.reviewedUncertified.priorProof,old.testedBy,'Archive must equal main proof: '+key);
          assert.deepEqual(row,{...old,status:'GAP',testedBy:null,
            reviewedUncertified:row.reviewedUncertified,reason:row.reason},'Only the verified withdrawal may change: '+key);
          withdrawn++;
        }
        continue;
      }
      // Four pre-existing manifest-driven citations moved with accounting
      // code. Only identical executable line text may move; all provenance,
      // scopes, source hashes, statuses and other fields must remain exact.
      const expected=structuredClone(old);
      if(JSON.stringify(row.testedBy)!==JSON.stringify(old.testedBy)){
        assert.equal(row.testedBy?.file,'scripts/qa/tenant-manifest-driven-http.mjs');
        assert.equal(old.testedBy?.file,row.testedBy.file);
        const before=execFileSync('git',['show',base.ref+':'+row.testedBy.file],{encoding:'utf8'}).split('\n');
        const after=readFileSync(row.testedBy.file,'utf8').split('\n');
        assert.deepEqual(Object.keys(row.testedBy).sort(),Object.keys(old.testedBy).sort());
        for(const [field,value]of Object.entries(row.testedBy)){
          if(value===old.testedBy[field])continue;
          assert.ok(field==='line'||field.endsWith('Line'),'Not a movable proof line: '+field);
          assert.ok(Number.isSafeInteger(value)&&value>0);
          assert.ok(before[old.testedBy[field]-1]?.trim(),'Old citation must exist');
          assert.equal(after[value-1],before[old.testedBy[field]-1],'Cited request/assertion text must be unchanged');
          expected.testedBy[field]=value;
        }
      }
      assert.deepEqual(row,expected,'Unrelated method cannot change: '+key);
    }
  }
  assert.deepEqual(manifest.scopedPages,prior.scopedPages,'Wage withdrawal cannot alter page credits');
  const {live}=assertLiveTenantCounts(assert,liveManifest);
  assert.equal(live.coveredAfter,priorLive.metrics.coveredAfter-withdrawn+renewed-(revoked.size?0:priorRenewed)-otherWithdrawals.size);
  assert.equal(live.gap,priorLive.metrics.gap+withdrawn-renewed+(revoked.size?0:priorRenewed)+otherWithdrawals.size);
  assert.equal(live.publicByDesign,prior.metrics.publicByDesign);
  assert.equal(live.privilegedOperationsTokenOnly,prior.metrics.privilegedOperationsTokenOnly);
  return true;
}

/** A verified hold must reject the previous credit verifier, not restore its old credit. */
export function assertCreditOrWageHold(assert,manifest,path,verb,verify){
  if(verifyWageRenewalMethod(manifest,path,verb))return 1;
  const prior=wageHeldPriorProof(manifest,path,verb);
  if(prior){
    assert.throws(()=>verify(manifest),'A historical receipt cannot certify changed wage source');
    return 0;
  }
  const row=manifest.allApiRouteFiles[path]?.methods.find(x=>x.name===verb);
  assert.equal(row?.status,'COVERED','Unrecognized credit withdrawal: '+verb+' '+path);
  assert.equal(verify(manifest),1);
  return 1;
}
