import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyWageRenewalEngineWithdrawal} from '../scripts/qa/wage-registry-renewal-supersession.mjs';
import {readWageRenewalReceipt,isWageRenewalKind} from '../scripts/qa/wage-registry-renewal-verify.mjs';

test('provider-switch source keeps all 75 renewals withdrawn and cannot reuse old execution',()=>{
  const manifest=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
  const before=structuredClone(manifest);
  assert.equal(verifyWageRenewalEngineWithdrawal(manifest).size,75);
  assert.deepEqual(manifest,before);
  assert.throws(()=>readWageRenewalReceipt(),/Executed runtime\/HTTP\/source drift/);
  for(const file of ['src/lib/payroll-engine.ts','src/lib/imported-benefit-prior.ts']) {
    assert.throws(()=>verifyWageRenewalEngineWithdrawal(manifest,path=>path===file
      ? Buffer.concat([readFileSync(path),Buffer.from('\n// unreviewed source')])
      : readFileSync(path)),/Unknown .*source|Wage renewal v2 source drift/);
  }
  // Tamper with one of the 75: a captured hold (zero credit) or a v2 per-method renewal (credited).
  const rows=Object.values(manifest.allApiRouteFiles).flatMap(f=>f.methods);
  const first=rows.find(row=>isWageRenewalKind(row.testedBy?.kind))??rows.find(row=>row.status==='GAP'&&row.reviewedUncertified?.kind?.startsWith('wage-registry-'));
  first.reason+=' forged';
  assert.throws(()=>verifyWageRenewalEngineWithdrawal(manifest),/fully withdrawn|provenance changed/);
});
