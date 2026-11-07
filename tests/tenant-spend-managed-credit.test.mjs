import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySpendManaged,TARGETS} from '../scripts/qa/tenant-spend-managed-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
test('three exact methods match the executed OFF-profile receipt and all source pins',()=>assert.equal(verifySpendManaged(manifest()),3));
test('changed runtime source and changed receipt are rejected',()=>{
 for(const target of ['src/app/api/spend/route.ts','scripts/qa/tenant-spend-managed-receipt.json','.github/workflows/tenant-spend-write-actions-http.yml'])
 assert.throws(()=>verifySpendManaged(manifest(),p=>{const bytes=readFileSync(p);return p===target?Buffer.concat([bytes,Buffer.from(' ') ]):bytes;}));
});
test('every unearned or altered method credit is rejected',()=>{
 for(const key of TARGETS){const m=manifest(),[verb,route]=key.split(' ');m.allApiRouteFiles['src/app/api/'+route+'/route.ts'].methods.find(x=>x.name===verb).testedBy.ownPositiveLine=1;assert.throws(()=>verifySpendManaged(m));}
});
