import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyRecoveryCredits,readRecoveryEvidence,RECOVERY_TARGETS,RECOVERY_RECEIPT} from '../scripts/qa/tenant-merged-recovery-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('three distinct merged methods have current-source, sealed actual PG16 HTTP receipts',()=>{
  assert.equal(verifyRecoveryCredits(manifest()),3);
  assert.equal(new Set(RECOVERY_TARGETS.map(x=>x.method+' '+x.path)).size,3);
  const r=readRecoveryEvidence();assert.equal(r.runs.scenarios.result.auditVetoRollbacks,2);
  assert.equal(r.runs.scenarios.result.scenarioDiscriminators,7);
  assert.equal(r.targets[0].evidence.boundary.includes('no claim of a 403'),true,
    'self-only GET selector handling must not be misrepresented as a tenant 403');
});
test('receipt, runtime or proof drift, missing methods and borrowed partial receipts fail closed',()=>{
  for(const file of [RECOVERY_RECEIPT,...Object.keys(readRecoveryEvidence().pins)]){
    const reader=(path,...args)=>path===file?Buffer.from('counterfeit'):readFileSync(path,...args);
    assert.throws(()=>verifyRecoveryCredits(manifest(),reader),/receipt changed|source\/proof drift/);
  }
  for(const t of RECOVERY_TARGETS){for(const patch of [{status:'GAP'},{testedBy:{file:t.evidence?.file}},{reviewedUncertified:{credits:0}}]){
    const m=manifest();Object.assign(m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method),patch);
    assert.throws(()=>verifyRecoveryCredits(m));
  }}
});
test('actual scenario execution, rather than only a fixture unit test, rejects a no-op validator',()=>{
  const source=readFileSync('scripts/qa/tenant-wps01-scenarios-http.mjs','utf8');
  assert.ok(source.includes('assert.throws(()=>assertWps01Created(response,added[0],wrongEmployer'));
  const noOp=()=>{};
  assert.throws(()=>assert.throws(noOp,/foreign scenario/,"scenario validator accepts another employer's data"),
    /scenario validator accepts another employer's data/);
});
