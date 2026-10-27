import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { RECOVERY_METHODS, verifyRecoveryReceipt } from '../scripts/qa/tenant-read-gap-recovery.mjs';

test('twelve executed method receipts bind row sources, actual engine and full victim checks', () => {
  const receipt = verifyRecoveryReceipt();
  assert.equal(new Set(RECOVERY_METHODS).size, 12);
  for (const mutate of [r => { r.runs.allowlisted.ownAndForeignPairs = 0; },
    r => { r.rowSources[0].sha256 = '0'.repeat(64); },
    r => { r.postgresMajor = 16; }, r => { r.methods.pop(); },
    r => { r.mutation.rejected = false; }]) {
    const bad = structuredClone(receipt); mutate(bad);
    assert.throws(() => verifyRecoveryReceipt(bad));
  }
});

test('only the selected twelve methods receive this local receipt and accurate PostgreSQL provenance', () => {
  const receipt = verifyRecoveryReceipt();
  const manifest = JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json', 'utf8'));
  const credited = [];
  for (const route of Object.values(manifest.allApiRouteFiles)) for (const method of route.methods) {
    const key = method.name + ' ' + route.route;
    if (!RECOVERY_METHODS.includes(key)) {
      assert.ok(!method.testedBy?.evidence?.includes(receipt.runLabel), key + ': unrelated receipt replaced');
      continue;
    }
    assert.equal(method.status, 'COVERED', key);
    assert.equal(method.testedBy.postgresMajor, receipt.postgresMajor);
    assert.ok(method.testedBy.evidence.includes(receipt.runLabel), key);
    assert.ok(method.testedBy.scope.includes('exact-head PG16 CI NOT_RUN'), key);
    credited.push(key);
  }
  assert.deepEqual(credited.sort(), [...RECOVERY_METHODS].sort());
});

test('local credit metadata rejects unsupported engines and unbounded selection', () => {
  for (const args of [ ['--local-postgres-major', '17', '--run-label', 'fictional'],
    ['--local-postgres-major', '18', '--run-label', 'fictional'] ]) {
    const result = spawnSync(process.execPath, ['scripts/qa/tenant-table-credit.mjs', '--check', ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /require/);
  }
});
