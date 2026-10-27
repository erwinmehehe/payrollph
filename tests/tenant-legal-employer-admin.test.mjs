import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRows } from '../scripts/qa/tenant-table-rows/write/legal-employer-admin.mjs';
import { retained, changedRequest } from '../scripts/qa/tenant-legal-employer-admin-proof.mjs';
import { validateTenantRow } from '../scripts/qa/tenant-table-loader.mjs';
import { METHODS, verifyReceipt } from '../scripts/qa/tenant-legal-employer-admin-receipt.mjs';
const rows = createRows();

test('legal-employer writes select genuine victim entities and requests under enabled profile', () => {
  assert.deepEqual(rows.map(row => row.key), ['PATCH multi-entity/settings', 'POST multi-entity/registration-changes', 'PATCH multi-entity/registration-changes']);
  const c = { orgId: 11, marker: 'FICTIONAL-A', rank: 1, seeded: { id: 3, entityId: 7 },
    victim: { org: { id: 44 } }, victimSeeded: { id: 33, entityId: 77 } };
  for (const row of rows) {
    assert.equal(row.profile, 'multi-entity'); assert.ok(row.flags.includes('MULTI_ENTITY_ENABLED'));
    assert.equal(row.ownBody(c).organizationId, 11); assert.equal(row.foreignBody(c).organizationId, 44);
    assert.equal(row.foreignBody(c).legalEntityId, 77);
    assert.equal(row.forged.body(c).organizationId, 11);
    assert.equal(row.query(c, 'foreign'), 'legalEntityId=77');
  }
});

test('settings expectation rejects no-op, foreign data, collateral grants/payroll/audit mutations', () => {
  const row = rows[0], c = { orgId: 11, owner: { id: 2, name: 'Fictional A' }, seeded: { id: 7 } };
  const before = { entities: [{ id: 7, organizationId: 11, payrollCalendarMode: 'flexible', legalName: 'Fictional A' }],
    grants: [], payroll: [], audits: [] };
  const after = structuredClone(before); after.entities[0].payrollCalendarMode = 'ph_semi_monthly';
  after.audits.push({ id: 1, organizationId: 11, actor: 'Fictional A', action: 'Legal employer pay schedule updated', resource: '7',
    metadata: { legalEntityId: 7, changedFields: ['payrollCalendarMode'], fromPaySchedule: 'flexible', toPaySchedule: 'ph_semi_monthly', actorUserId: 2, sensitiveValuesRedacted: true } });
  const response = { json: { entity: { id: 7, payrollCalendarMode: 'ph_semi_monthly' } } };
  row.expect(before, after, c, response);
  assert.throws(() => row.expect(before, before, c, response));
  assert.throws(() => row.expect(before, after, { ...c, orgId: 44 }, response));
  for (const mutate of [x => x.grants.push({ id: 1 }), x => x.payroll.push({ id: 2 }),
    x => { x.entities[0].legalName = 'Victim'; }, x => { x.audits[0].metadata.actorUserId = 9; }]) {
    const changed = structuredClone(after); mutate(changed); assert.throws(() => row.expect(before, changed, c, response));
  }
});

test('decision proof rejects stale/no-op, wrong checker, self decision and other request edits', () => {
  const request = { id: 9, organizationId: 11, legalEntityId: 7, status: 'pending_approval', requestedByUserId: 3,
    decidedByUserId: null, decidedAt: null, reason: 'Fictional evidence' };
  const before = { requests: [request] }, after = { requests: [{ ...request, status: 'rejected', decidedByUserId: 2, decidedAt: '2026-10-27T00:00:00Z' }] };
  const c = { orgId: 11, owner: { id: 2 } };
  changedRequest(before, after, c, 9, 7, 'rejected');
  assert.throws(() => changedRequest(before, before, c, 9, 7, 'rejected'));
  for (const delta of [{ organizationId: 44 }, { legalEntityId: 77 }, { decidedByUserId: 3 }, { reason: 'Changed' }]) {
    assert.throws(() => changedRequest(before, { requests: [{ ...after.requests[0], ...delta }] }, c, 9, 7, 'rejected'));
  }
  assert.throws(() => changedRequest(before, after, { ...c, owner: { id: 3 } }, 9, 7, 'rejected'));
  assert.throws(() => retained({ payroll: [] }, { payroll: [{ id: 1 }] }, []));
});

test('optional actions are executable and cannot replace primary shared assertions', () => {
  const row = rows[0], spec = { ...row, kind: 'write', profile: row.profile, flags: row.flags };
  validateTenantRow(row, spec);
  assert.throws(() => validateTenantRow({ ...row, exercise: true }, spec), /must be executable/);
  const source = readFileSync('scripts/qa/tenant-write-table-http.mjs', 'utf8');
  assert.ok(source.indexOf('await item.exercise?.') > source.indexOf('a forged victim reference must write nothing'));
  assert.ok(source.indexOf('await item.exercise?.') < source.indexOf('const victimAfter = await victimSnapshot'));
});

test('credit receipt binds all five identities, both approval attackers and exact proof sources', () => {
  const receipt = verifyReceipt(); assert.deepEqual(receipt.methods, METHODS);
  const manifest = JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json', 'utf8'));
  for (const key of METHODS) {
    const [verb, route] = key.split(' ');
    const method = Object.values(manifest.allApiRouteFiles).find(record => record.route === route).methods.find(method => method.name === verb);
    assert.equal(method.status, 'COVERED'); assert.equal(method.testedBy.postgresMajor, receipt.postgresMajor);
    assert.equal(method.testedBy.localReceipt, 'docs/qa/tenant-legal-employer-admin-receipt.json');
    assert.ok(method.testedBy.evidence.includes(receipt.runLabel));
    if (key === 'PATCH multi-entity/registration-changes') assert.equal(method.testedBy.additionalActionProof.sha256,
      receipt.sources.find(pin => pin.file === method.testedBy.rowFile).sha256);
  }
  for (const alter of [r => { r.methods.pop(); }, r => { r.sources[0].sha256 = '0'.repeat(64); },
    r => { r.runs.write.additionalActionProofs = []; }, r => { r.runs.write.discriminatingProofs = 0; },
    r => { r.mutation.rejected = false; }, r => { r.runs.read.victimDatabaseUnchanged = false; }]) {
    const broken = structuredClone(receipt); alter(broken); assert.throws(() => verifyReceipt(broken));
  }
});
