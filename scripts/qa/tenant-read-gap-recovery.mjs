import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tenantFamilyCatalog } from './tenant-table-catalog.mjs';

export const RECOVERY_RECEIPT = 'docs/qa/tenant-read-gap-recovery-receipt.json';
export const RECOVERY_METHODS = Object.freeze([
  'GET hcm/manager-decision-inbox', 'GET hcm/org-explorer', 'GET hcm/position-history',
  'GET hcm/process-monitor', 'GET hcm/team-leave-calendar', 'GET hcm/work-items/events',
  'GET workforce/demand-observations/outlook', 'GET workforce/demand-outlook',
  'GET workforce/schedule-receipt-review', 'PATCH hcm/work-items',
  'POST hcm/employment-terms', 'POST loans',
]);

export function verifyRecoveryReceipt(receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT, 'utf8'))) {
  assert.equal(receipt.schema, 'local-tenant-gap-recovery-v1');
  assert.deepEqual(receipt.methods, RECOVERY_METHODS);
  assert.ok([16, 18].includes(receipt.postgresMajor));
  assert.equal(Math.floor(receipt.serverVersionNum / 10000), receipt.postgresMajor);
  assert.equal(receipt.productionTested, false);
  assert.equal(receipt.mutation.method, 'POST loans');
  assert.equal(receipt.mutation.rejected, true);
  const expected = { allowlisted: [8, 16, 8], defaultRead: [12, 24, 12],
    hcmWrite: [11, 22, 11], loansWrite: [2, 4, 2] };
  for (const [name, counts] of Object.entries(expected)) {
    const run = receipt.runs[name];
    assert.deepEqual([run.rows, run.ownAndForeignPairs, run.discriminatingProofs], counts, name);
    assert.equal(run.victimDatabaseUnchanged, true, name);
    assert.equal(run.productionTested, false, name);
    assert.equal(run.certified, false, name);
  }
  assert.equal(receipt.unlistedGate.gateRoutes, 8);
  assert.equal(receipt.unlistedGate.statuses, '404');
  const catalog = [...tenantFamilyCatalog('read'), ...tenantFamilyCatalog('write')];
  assert.equal(receipt.rowSources.length, RECOVERY_METHODS.length);
  for (const [index, key] of RECOVERY_METHODS.entries()) {
    const spec = catalog.find(row => row.key === key);
    assert.ok(spec, 'missing actual catalog row: ' + key);
    const pin = receipt.rowSources[index];
    assert.equal(pin.key, key); assert.equal(pin.file, spec.file);
    assert.equal(pin.sha256, createHash('sha256').update(spec.text).digest('hex'), key + ': changed row requires renewed proof');
  }
  const snapshot = 'scripts/qa/tenant-read-recovery-snapshot.mjs';
  assert.equal(receipt.snapshotSha256, createHash('sha256').update(readFileSync(snapshot, 'utf8').replaceAll('\r\n', '\n')).digest('hex'));
  return receipt;
}
