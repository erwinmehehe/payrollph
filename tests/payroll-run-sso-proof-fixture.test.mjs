import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {zeroCreditSsoProofFixture} from '../scripts/qa/payroll-run-sso-proof-fixture.mjs';
import {ORACLE_HELD_METHODS,verifyOracleSourceHolds} from '../scripts/qa/payroll-run-oracle-hold.mjs';
const read=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('disposable bootstrap removes exactly nineteen stale credits without weakening or editing their guards',()=>{
  const m=read(),copy=structuredClone(m),f=zeroCreditSsoProofFixture(m);
  assert.deepEqual(m,copy);
  const heldCount=ORACLE_HELD_METHODS.length;
  assert.equal(heldCount,19,'Only the exact historical payroll cohort may be held');
  assert.equal(m.metrics.coveredAfter-f.metrics.coveredAfter,heldCount);
  assert.equal(f.metrics.gap-m.metrics.gap,heldCount);
  assert.equal(verifyOracleSourceHolds(f).size,19);
  for(const[path,entry]of Object.entries(m.allApiRouteFiles)){
    const next=f.allApiRouteFiles[path];
    assert.equal(next.gitBlobSha,entry.gitBlobSha);
    for(const row of entry.methods)if(row.testedBy?.kind!=='payroll-run-source-renewal-real-http-pg16')
      assert.deepEqual(next.methods.find(r=>r.name===row.name),row,'Unrelated method must remain unchanged');
  }
  assert.throws(()=>zeroCreditSsoProofFixture(f),'No double withdrawal');
});
test('invented holds, changed source pins and missing renewals cannot bootstrap the proof',()=>{
  for(const mutate of[
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].methods.find(r=>r.name==='GET').historicalOracleSourceWithdrawal.priorProof={};},
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].gitBlobSha='0'.repeat(40);},
    m=>{m.allApiRouteFiles['src/app/api/payroll-runs/route.ts'].methods.find(r=>r.name==='GET').status='GAP';},
  ]){const m=read();mutate(m);assert.throws(()=>zeroCreditSsoProofFixture(m));}
});
