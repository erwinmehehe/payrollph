/** Capture the immutable pre-renewal inventory. This grants no method credits. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifiedWageCreditHolds} from './wage-registry-credit-holds.mjs';

export const INVENTORY='scripts/qa/wage-registry-renewal-inventory.json';
export const INVENTORY_BLOB='eee74d6df0a1a39257f09bb58ee1231d1ad09d72';
export function readWageRenewalInventory(read=readFileSync){
 const raw=Buffer.from(read(INVENTORY));
 assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),INVENTORY_BLOB,'The captured withdrawal inventory is immutable');
 const result=JSON.parse(raw);
 assert.equal(result.schema,'payrollph-wage-source-renewal-inventory-v1');
 assert.equal(result.label,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(result.methods.length,75);
 assert.equal(new Set(result.methods.map(x=>x.verb+' '+x.path)).size,75);
 for(const entry of result.methods){
  assert.equal(entry.held.name,entry.verb);assert.equal(entry.held.status,'GAP');assert.equal(entry.held.testedBy,null);
  assert.equal(entry.held.reviewedUncertified.coverageCredits,0);
  assert.equal(entry.held.reviewedUncertified.execution,'NOT_RUN');
 }
 return result;
}
export function captureWageRenewalInventory(){
 assert.ok(!existsSync(INVENTORY),'Never overwrite the captured historical withdrawal');
 const manifest=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 assert.equal(verifiedWageCreditHolds(manifest).size,75);
 const baseMainCommit=execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim();
 const base=JSON.parse(execFileSync('git',['show',baseMainCommit+':scripts/qa/tenant-isolation-coverage-manifest.json'],{encoding:'utf8',maxBuffer:16*1024*1024}));
 assert.deepEqual(manifest,base,'Capture only current main, before any promotions');
 const methods=Object.entries(manifest.allApiRouteFiles).flatMap(([path,file])=>file.methods
  .filter(row=>row.reviewedUncertified?.kind?.startsWith('wage-registry-'))
  .map(held=>({path,verb:held.name,routeBlobSha:file.gitBlobSha,held})));
 assert.equal(methods.length,75);
 const inventory={schema:'payrollph-wage-source-renewal-inventory-v1',baseMainCommit,
  label:'SOLO_VERIFIED_DEV_RECOVERY',methods};
 writeFileSync(INVENTORY,JSON.stringify(inventory,null,2)+'\n');
 return {methods:methods.length,baseMainCommit,credits:0};
}
if(process.argv.includes('--capture'))console.log(JSON.stringify(captureWageRenewalInventory()));
