import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tenantFamilyCatalog } from './tenant-table-catalog.mjs';

export const RECEIPT = 'docs/qa/tenant-legal-employer-admin-receipt.json';
export const METHODS = Object.freeze(['PATCH multi-entity/context', 'PATCH multi-entity/settings',
  'GET multi-entity/registration-changes', 'POST multi-entity/registration-changes', 'PATCH multi-entity/registration-changes']);
export const HELPERS = Object.freeze(['scripts/qa/tenant-legal-employer-admin-proof.mjs',
  'scripts/qa/tenant-table-loader.mjs', 'scripts/qa/tenant-table-http.mjs', 'scripts/qa/tenant-write-table-http.mjs']);
export const digest = file => createHash('sha256').update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).digest('hex');

export function verifyReceipt(receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'))) {
  assert.equal(receipt.schema, 'local-legal-employer-admin-proof-v1');
  assert.deepEqual(receipt.methods, METHODS);
  assert.ok([16, 18].includes(receipt.postgresMajor));
  assert.equal(Math.floor(receipt.serverVersionNum / 10000), receipt.postgresMajor);
  assert.equal(receipt.productionTested, false);
  assert.equal(receipt.ci, 'NOT_RUN');
  assert.equal(receipt.mutation.method, 'PATCH multi-entity/settings');
  assert.equal(receipt.mutation.rejected, true);
  assert.match(receipt.mutation.message, /expect accepts another employer's data/);
  for (const kind of ['read', 'write']) {
    const run = receipt.runs[kind];
    assert.equal(run.kind, kind === 'read' ? 'tenant-table-proof' : 'tenant-write-table-proof');
    assert.equal(run.profile, 'multi-entity');
    assert.deepEqual([run.rows, run.ownAndForeignPairs, run.discriminatingProofs], [4, 8, 4]);
    assert.equal(run.victimDatabaseUnchanged, true); assert.equal(run.productionTested, false); assert.equal(run.certified, false);
  }
  assert.equal(receipt.runs.write.forgedReferenceProofs, 8);
  const approval = receipt.runs.write.additionalActionProofs.filter(row => row.key === 'PATCH multi-entity/registration-changes');
  assert.equal(approval.length, 2);
  assert.deepEqual(approval.map(row => row.attacker), [1, 2]);
  assert.deepEqual(approval.map(row => row.approvalDiscrimination), [0, 1]);
  for (const proof of approval) {
    assert.equal(proof.ownAndForeignPairs, 1);
    assert.deepEqual(proof.controls, ['approve', 'foreign-request-denied', 'self-approval-denied', 'replay-denied']);
  }
  for (const [key, controls] of [['PATCH multi-entity/settings', ['idempotent-no-write', 'unversioned-identity-denied']],
    ['PATCH multi-entity/context', ['owner-all-entities-denied']]]) {
    const proofs = receipt.runs.write.additionalActionProofs.filter(row => row.key === key);
    assert.deepEqual(proofs.map(row => row.attacker), [1, 2]);
    for (const proof of proofs) assert.deepEqual(proof.controls, controls);
  }
  const catalog = [...tenantFamilyCatalog('read'), ...tenantFamilyCatalog('write')];
  assert.equal(receipt.sources.length, METHODS.length + HELPERS.length);
  for (const [index, key] of METHODS.entries()) {
    const row = catalog.find(spec => spec.key === key), pin = receipt.sources[index];
    assert.ok(row); assert.equal(pin.key, key); assert.equal(pin.file, row.file);
    assert.equal(pin.sha256, digest(row.file), key + ': source drift requires renewed HTTP evidence');
  }
  for (const [index, file] of HELPERS.entries()) {
    const pin = receipt.sources[METHODS.length + index];
    assert.equal(pin.file, file); assert.equal(pin.sha256, digest(file), file + ': helper source drift');
  }
  return receipt;
}
