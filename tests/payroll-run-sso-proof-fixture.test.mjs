import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {zeroCreditSsoProofFixture} from '../scripts/qa/payroll-run-sso-proof-fixture.mjs';
import {ORACLE_HELD_METHODS,verifyOracleSourceHolds} from '../scripts/qa/payroll-run-oracle-hold.mjs';
const read=()=>readWageWithdrawalFixture();
test('fresh wage renewals can be zeroed only in the disposable nineteen-method fixture, without changing the live ledger',()=>{
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',raw=readFileSync(path,'utf8'),m=JSON.parse(raw);
 const f=zeroCreditSsoProofFixture(m),allowed=new Set(ORACLE_HELD_METHODS);
 assert.equal(m.metrics.coveredAfter-f.metrics.coveredAfter,ORACLE_HELD_METHODS.length);
 assert.equal(f.metrics.gap-m.metrics.gap,ORACLE_HELD_METHODS.length);
 for(const [file,route] of Object.entries(m.allApiRouteFiles))for(const row of route.methods){
  const next=f.allApiRouteFiles[file].methods.find(r=>r.name===row.name);
  if(allowed.has(row.name+' '+route.route)){assert.equal(next.status,'GAP');assert.equal(next.testedBy,null);}
  else assert.deepEqual(next,row);
 }
 assert.equal(verifyOracleSourceHolds(f).size,19);
 assert.deepEqual(zeroCreditSsoProofFixture(f),f);
 assert.equal(readFileSync(path,'utf8'),raw);
});
test('disposable bootstrap removes exactly nineteen stale credits without weakening or editing their guards',()=>{
  const m=read(),copy=structuredClone(m),f=zeroCreditSsoProofFixture(m);
  assert.deepEqual(m,copy);
  const heldCount=ORACLE_HELD_METHODS.length;
  assert.equal(heldCount,19,'Only the exact historical payroll cohort may be held');
  const alreadyHeld=ORACLE_HELD_METHODS.filter(key=>{
    const at=key.indexOf(' '),verb=key.slice(0,at),path='src/app/api/'+key.slice(at+1)+'/route.ts';
    return m.allApiRouteFiles[path].methods.find(row=>row.name===verb)?.reviewedUncertified?.kind===
      'wage-registry-dependency-source-withdrawal';
  }).length;
  assert.equal(m.metrics.coveredAfter-f.metrics.coveredAfter,heldCount-alreadyHeld);
  assert.equal(f.metrics.gap-m.metrics.gap,heldCount-alreadyHeld);
  assert.equal(verifyOracleSourceHolds(f).size,19);
  for(const[path,entry]of Object.entries(m.allApiRouteFiles)){
    const next=f.allApiRouteFiles[path];
    assert.equal(next.gitBlobSha,entry.gitBlobSha);
    for(const row of entry.methods)if(row.testedBy?.kind!=='payroll-run-source-renewal-real-http-pg16')
      assert.deepEqual(next.methods.find(r=>r.name===row.name),row,'Unrelated method must remain unchanged');
  }
  assert.deepEqual(zeroCreditSsoProofFixture(f),f,
    'Already source-verified zero-credit holds are idempotent, not re-credited');
});
test('invented holds, changed source pins and missing renewals cannot bootstrap the proof',()=>{
  for(const mutate of[
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].methods.find(r=>r.name==='GET').historicalOracleSourceWithdrawal.priorProof={};},
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].gitBlobSha='0'.repeat(40);},
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].methods.find(r=>r.name==='GET').testedBy={file:'forged'};},
  ]){const m=read();mutate(m);assert.throws(()=>zeroCreditSsoProofFixture(m));}
});
