import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditBusinessSnapshot } from './tenant-table-invariants.mjs';

let loaded;
export function runtime() {
  return loaded ??= Promise.all([import('../../src/db/index.ts'), import('../../src/db/schema.ts'),
    import('../../src/lib/multi-entity-registration-storage.ts'), import('../../src/lib/government-id-crypto.ts'),
    import('../../src/lib/bank-account-crypto.ts')]).then(([database, schema, storage, government, bank]) => ({
      ...database, schema, entities: storage.registeredLegalEntities, government, bank,
    }));
}

export function today() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}

export function proposedProfile(marker, rank) {
  return { legalName: marker + ' Fictional Registered Inc.', registeredAddress: '123 Fictional Test Street',
    birTin: '00000000' + rank, birBranchCode: '0000', sssEmployerNo: 'SYNTH-' + rank,
    philHealthEmployerNo: 'SYNTH-' + rank, pagIbigEmployerNo: 'SYNTH-' + rank,
    disbursementBankCode: 'TESTBANK', disbursementAccountName: marker + ' Fictional Account',
    disbursementAccount: '00000000' + rank };
}

export async function legalAdminSnapshot(orgId) {
  const { db, schema: s, entities } = await runtime();
  const result = {};
  for (const [key, table] of Object.entries({ entities, preferences: s.userEntityPreferences,
    grants: s.userLegalEntityGrants, requests: s.legalEntityProfileChangeRequests,
    versions: s.legalEntityStatutoryRegistrations, workers: s.employees,
    payProfiles: s.employeePayProfiles, payroll: s.payrollRuns, audits: s.auditEvents })) {
    result[key] = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(table.id);
  }
  result.audits = auditBusinessSnapshot(result.audits);
  return result;
}

export async function grant(employer, entityId = employer.entity.id, userId = employer.owner.id) {
  const { db, schema: s } = await runtime();
  await db.insert(s.userLegalEntityGrants).values({ organizationId: employer.org.id, userId, legalEntityId: entityId }).onConflictDoNothing();
}

export async function newEntity(e, suffix) {
  const { db, entities } = await runtime();
  await grant(e);
  const [entity] = await db.insert(entities).values({ organizationId: e.org.id,
    code: (e.marker + suffix).slice(0, 40), legalName: e.marker + suffix + ' Fictional Inc.',
    displayName: e.marker + suffix, primaryEntity: false, payrollCalendarMode: 'flexible' }).returning();
  await grant(e, entity.id);
  return entity;
}

export async function pendingRequest(e, entity, makerId, changes) {
  const { pool, government } = await runtime();
  const envelope = government.encryptGovernmentId(JSON.stringify(changes), { required: true });
  assert.ok(envelope);
  const { rows: [record] } = await pool.query('INSERT INTO legal_entity_profile_change_requests ' +
    '(organization_id,legal_entity_id,expected_entity_updated_at,effective_date,changed_fields,profile_envelope,reason,requested_by_user_id) ' +
    'SELECT $1,$2,updated_at,$3,$4::jsonb,$5,$6,$7 FROM legal_entities WHERE organization_id=$1 AND id=$2 RETURNING id',
  [e.org.id, entity.id, today(), JSON.stringify(Object.keys(changes)), envelope, e.marker + ' fictional reviewed request', makerId]);
  assert.ok(Number.isSafeInteger(record?.id));
  return { id: record.id, entityId: entity.id };
}

export function retained(before, after, allowed) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const key of Object.keys(before)) if (!allowed.includes(key)) assert.deepEqual(after[key], before[key], key + ' must not change');
}

export function auditAdded(before, after, c, action) {
  const added = after.audits.filter(row => !before.audits.some(old => old.id === row.id));
  assert.equal(added.length, 1); assert.equal(after.audits.length, before.audits.length + 1);
  const event = added[0]; assert.equal(event.organizationId, c.orgId);
  assert.equal(event.actor, c.owner.name); assert.equal(event.action, action);
  assert.deepEqual(after.audits.filter(row => row.id !== event.id), before.audits);
  return event;
}

export function changedRequest(before, after, c, requestId, entityId, status) {
  assert.equal(before.requests.length, after.requests.length);
  const old = before.requests.find(row => row.id === requestId), row = after.requests.find(item => item.id === requestId);
  assert.ok(old && row); assert.equal(row.organizationId, c.orgId); assert.equal(row.legalEntityId, entityId);
  assert.equal(old.status, 'pending_approval'); assert.equal(row.status, status);
  assert.notEqual(old.requestedByUserId, c.owner.id); assert.equal(row.decidedByUserId, c.owner.id);
  assert.ok(Number.isFinite(Date.parse(row.decidedAt)));
  const stable = ({ status: _status, decidedByUserId: _by, decidedAt: _at, ...rest }) => rest;
  assert.deepEqual(stable(row), stable(old));
  assert.deepEqual(after.requests.filter(item => item.id !== row.id), before.requests.filter(item => item.id !== row.id));
  return row;
}

export async function proveApproval(before, after, c, response) {
  retained(before, after, ['entities', 'requests', 'versions', 'audits']);
  const target = c.seeded.approve;
  const request = changedRequest(before, after, c, target.id, target.entityId, 'approved');
  assert.equal(before.versions.filter(row => row.legalEntityId === target.entityId).length, 0);
  assert.equal(after.versions.length, before.versions.length + 1);
  const version = after.versions.find(row => !before.versions.some(old => old.id === row.id));
  assert.ok(version); assert.equal(version.organizationId, c.orgId); assert.equal(version.legalEntityId, target.entityId);
  assert.equal(version.sourceChangeId, target.id); assert.equal(version.revision, 1); assert.equal(version.approvedByUserId, c.owner.id);
  assert.equal(version.effectiveDate, today());
  assert.deepEqual(after.versions.filter(row => row.id !== version.id), before.versions);
  const entity = after.entities.find(row => row.id === target.entityId), old = before.entities.find(row => row.id === target.entityId);
  assert.ok(entity && old); assert.equal(entity.organizationId, c.orgId);
  for (const [key, value] of Object.entries(c.seeded.changes)) if (key !== 'disbursementAccount') assert.equal(entity[key], value);
  const { government, bank } = await runtime();
  assert.equal(bank.decryptBankAccount(entity.disbursementAccount), c.seeded.changes.disbursementAccount);
  assert.notEqual(entity.disbursementAccount, c.seeded.changes.disbursementAccount);
  const profile = JSON.parse(government.decryptGovernmentId(version.profileEnvelope));
  for (const [key, value] of Object.entries(c.seeded.changes)) if (key !== 'disbursementAccount') assert.equal(profile[key], value);
  assert.equal(profile.disbursementAccount, entity.disbursementAccount);
  const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => ![...Object.keys(c.seeded.changes), 'updatedAt'].includes(key)));
  assert.deepEqual(stable(entity), stable(old));
  assert.deepEqual(after.entities.filter(row => row.id !== entity.id), before.entities.filter(row => row.id !== entity.id));
  assert.deepEqual(response.json, { id: target.id, status: 'approved', revision: 1 });
  const audit = auditAdded(before, after, c, 'Employer profile version approved');
  assert.equal(audit.resource, String(target.entityId));
  assert.deepEqual(audit.metadata, { requestId: target.id, revision: 1, changedFields: request.changedFields,
    makerUserId: c.seeded.makerId, checkerUserId: c.owner.id, sensitiveValuesRedacted: true });
}
