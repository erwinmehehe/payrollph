import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {verifiedWageCreditHolds,wageHeldPriorProof} from '../scripts/qa/wage-registry-credit-holds.mjs';
import {assertWageLedgerDelta} from './helpers/wage-source-holds.mjs';
const load=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('all 75 current holds are disjoint, zero-credit and retain immutable prior evidence',()=>{
 const m=load(),before=structuredClone(m),held=verifiedWageCreditHolds(m);
 assert.equal(held.size,75);
 for(const key of held){const at=key.indexOf(' ');assert.ok(wageHeldPriorProof(m,key.slice(at+1),key.slice(0,at)));}
 assert.deepEqual(m,before);
});
test('partial holds, restored credits, modified evidence and later source changes fail closed',()=>{
 for(const mutate of [
  m=>{delete m.allApiRouteFiles['src/app/api/employees/route.ts'].methods[0].reviewedUncertified;},
  m=>{m.allApiRouteFiles['src/app/api/approvals/[id]/route.ts'].methods[0].status='COVERED';},
  m=>{m.allApiRouteFiles['src/app/api/automation-studio/route.ts'].methods.find(x=>x.name==='POST').testedBy={claimed:true};},
 ]){const m=load();mutate(m);assert.throws(()=>verifiedWageCreditHolds(m));}
 assert.throws(()=>verifiedWageCreditHolds(load(),p=>Buffer.concat([readFileSync(p),Buffer.from(' changed')])));
});
test('generic table selection cannot credit a held method even with an alleged fresh run label',()=>{
 const files=['scripts/qa/tenant-isolation-coverage-manifest.json','docs/engineering/tenant-isolation-coverage-inventory.md'];
 const before=files.map(p=>readFileSync(p));
 for(const mode of [['--check'],['--run-label','not a dedicated wage renewal']]){
  const r=spawnSync(process.execPath,['scripts/qa/tenant-table-credit.mjs','--only-key','POST compliance/validate',...mode],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/wage-dependent source proof is HELD/);
  files.forEach((p,i)=>assert.deepEqual(readFileSync(p),before[i]));
 }
 const r=spawnSync(process.execPath,['scripts/qa/tenant-table-credit.mjs','--check'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
 assert.equal(result.newlyCredited,0);assert.deepEqual(result.before,result.after);
});

test('the current-ledger guard rejects unrelated edits, false counts and borrowed proof lines',()=>{
 assert.equal(assertWageLedgerDelta(assert,load()),true);
 for(const mutate of [
  m=>{m.metrics.coveredAfter++;m.metrics.gap--;},
  m=>{m.allApiRouteFiles['src/app/api/account/route.ts'].methods[0].reason+=' fabricated';},
  m=>{m.allApiRouteFiles['src/app/api/compliance/statutory-remittances/payment-evidence/route.ts'].methods[0].testedBy.ownPositiveLine=1;},
  m=>{m.scopedPages[0].status='GAP';},
 ]){const m=load();mutate(m);assert.throws(()=>assertWageLedgerDelta(assert,m));}
});

test('historical wage bytes do not conceal a newly changed statutory watch',()=>{
 // Pin this test's real pre-withdrawal input, so it remains meaningful when
 // origin/main eventually contains this PR's 75 holds and updated registry.
 const historicalMain='d7393966e6b2ea14430fc76b558e5cf1fb77735c';
 const m=load(),base=JSON.parse(execFileSync('git',
   ['show',historicalMain+':scripts/qa/tenant-isolation-coverage-manifest.json'],{maxBuffer:16<<20}));
 const historicalRead=p=>execFileSync('git',['show',historicalMain+':'+p],{maxBuffer:16<<20});
 assert.equal(verifiedWageCreditHolds(base,historicalRead).size,0);
 assert.throws(()=>verifiedWageCreditHolds(base,p=>p==='src/lib/statutory-rule-watch.ts'
   ?readFileSync(p):historicalRead(p)),/changed statutory watch/);
 assert.equal(verifiedWageCreditHolds(m).size,75);
});
