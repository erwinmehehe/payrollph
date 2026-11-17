import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {verifiedWageCreditHolds,wageHeldPriorProof} from '../scripts/qa/wage-registry-credit-holds.mjs';
import {assertWageLedgerDelta,historicalWageCatalog} from './helpers/wage-source-holds.mjs';
import {assertLiveTenantCounts} from './helpers/tenant-counts.mjs';
const load=()=>readWageWithdrawalFixture();
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

test('a projected historical hold cannot conceal an unrelated current-ledger downgrade',()=>{
 const m=load();
 const file=m.allApiRouteFiles['src/app/api/workforce/attendance-exceptions/route.ts'];
 const row=file.methods.find(method=>method.name==='GET');
 assert.equal(row?.status,'COVERED','The adversarial control must start from a proven method');
 row.status='GAP';
 row.testedBy=null;
 row.reason='unapproved source-independent downgrade';
 m.metrics.coveredAfter--;m.metrics.gap++;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: [0-9]+ API methods/,
   'NOT ACCEPTED: '+m.metrics.gap+' API methods');
 assert.throws(()=>assertLiveTenantCounts(assert,m),/no proven method may be downgraded/,
   'A verified historical fixture cannot excuse an unrelated loss of security proof');
});

test('historical wage bytes do not conceal a newly changed statutory watch',()=>{
 // Real pre-withdrawal bytes, checked by the guard's immutable Git blob pins.
 // A fixture keeps this regression valid after merge and in shallow CI clones.
 const fixture=JSON.parse(readFileSync('tests/fixtures/wage-registry-prewithdrawal-inputs.json','utf8'));
 assert.equal(fixture.schema,'payrollph-wage-version-coherence-fixture-v1');
 assert.equal(fixture.sourceCommit,'d7393966e6b2ea14430fc76b558e5cf1fb77735c');
 const m=load(),base=historicalWageCatalog(m);
 const historicalRead=p=>{assert.ok(Object.hasOwn(fixture.inputs,p));return Buffer.from(fixture.inputs[p]);};
 assert.equal(verifiedWageCreditHolds(base,historicalRead).size,0);
 assert.throws(()=>verifiedWageCreditHolds(base,p=>p==='src/lib/statutory-rule-watch.ts'
   ?readFileSync(p):historicalRead(p)),/changed statutory watch/);
 assert.equal(verifiedWageCreditHolds(m).size,75);
});
