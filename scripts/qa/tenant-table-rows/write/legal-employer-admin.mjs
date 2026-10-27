import assert from 'node:assert/strict';
import { runtime, today, proposedProfile, legalAdminSnapshot, grant, newEntity, pendingRequest,
  retained, auditAdded, changedRequest, proveApproval } from '../../tenant-legal-employer-admin-proof.mjs';

export const fixtureOrder = {};
export function createRows() {
  const state = legalAdminSnapshot;
  const entityQuery = (c, target) => 'legalEntityId=' + (target === 'foreign' ? c.victimSeeded.entityId : c.seeded.entityId);
  let firstApproval;
  return [
    { key: "PATCH multi-entity/settings", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"],
      seed: async e => { const entity = await newEntity(e, '-PAY'); return { id: entity.id, entityId: entity.id }; },
      query: entityQuery, state: state,
      ownBody: c => ({ organizationId: c.orgId, legalEntityId: c.seeded.entityId, payrollCalendarMode: 'ph_semi_monthly' }),
      foreignBody: c => ({ organizationId: c.victim.org.id, legalEntityId: c.victimSeeded.entityId, payrollCalendarMode: 'ph_semi_monthly' }),
      forged: { status: 403, body: c => ({ organizationId: c.orgId, legalEntityId: c.victimSeeded.entityId, payrollCalendarMode: 'ph_semi_monthly' }) },
      expect: (before, after, c, response) => {
        retained(before, after, ['entities', 'audits']);
        const old = before.entities.find(row => row.id === c.seeded.id), row = after.entities.find(item => item.id === c.seeded.id);
        assert.ok(old && row); assert.equal(row.organizationId, c.orgId);
        assert.equal(old.payrollCalendarMode, 'flexible'); assert.equal(row.payrollCalendarMode, 'ph_semi_monthly');
        const stable = ({ payrollCalendarMode: _mode, updatedAt: _date, ...rest }) => rest;
        assert.deepEqual(stable(row), stable(old));
        assert.deepEqual(after.entities.filter(item => item.id !== row.id), before.entities.filter(item => item.id !== row.id));
        assert.equal(response.json.entity.id, row.id); assert.equal(response.json.entity.payrollCalendarMode, row.payrollCalendarMode);
        const event = auditAdded(before, after, c, 'Legal employer pay schedule updated');
        assert.equal(event.resource, String(row.id));
        assert.deepEqual(event.metadata, { legalEntityId: row.id, changedFields: ['payrollCalendarMode'],
          fromPaySchedule: 'flexible', toPaySchedule: 'ph_semi_monthly', actorUserId: c.owner.id, sensitiveValuesRedacted: true });
      },
      exercise: async (c, io) => {
        const url = '/api/multi-entity/settings?legalEntityId=' + c.seeded.entityId;
        const before = await state(c.orgId);
        io.expectStatus(await io.request(url, { method: 'PATCH', cookie: io.cookie,
          body: { organizationId: c.orgId, legalEntityId: c.seeded.entityId, payrollCalendarMode: 'ph_semi_monthly' } }), 200, 'idempotent schedule readback');
        assert.deepEqual(await state(c.orgId), before);
        io.expectStatus(await io.request(url, { method: 'PATCH', cookie: io.cookie,
          body: { organizationId: c.orgId, legalEntityId: c.seeded.entityId, legalName: c.marker + ' unversioned forbidden' } }), 409, 'protected identity must use versioned review');
        assert.deepEqual(await state(c.orgId), before);
        return { controls: ['idempotent-no-write', 'unversioned-identity-denied'] };
      } },
    { key: "POST multi-entity/registration-changes", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED", "MULTI_ENTITY_REGISTRATIONS_ENABLED"], status: 201,
      seed: async e => { const entity = await newEntity(e, '-PROP'); return { id: entity.id, entityId: entity.id }; },
      query: entityQuery, state: state,
      ownBody: c => ({ organizationId: c.orgId, legalEntityId: c.seeded.entityId, effectiveDate: today(),
        changes: proposedProfile(c.marker, c.rank), reason: c.marker + ' fictional proposal' }),
      foreignBody: c => ({ organizationId: c.victim.org.id, legalEntityId: c.victimSeeded.entityId, effectiveDate: today(),
        changes: proposedProfile(c.marker, c.rank), reason: c.marker + ' fictional proposal' }),
      forged: { status: 403, body: c => ({ organizationId: c.orgId, legalEntityId: c.victimSeeded.entityId, effectiveDate: today(),
        changes: proposedProfile(c.marker, c.rank), reason: c.marker + ' fictional proposal' }) },
      expect: async (before, after, c, response) => {
        retained(before, after, ['requests', 'audits']);
        assert.equal(after.requests.length, before.requests.length + 1);
        const added = after.requests.filter(row => !before.requests.some(old => old.id === row.id)); assert.equal(added.length, 1);
        const row = added[0]; assert.equal(row.organizationId, c.orgId); assert.equal(row.legalEntityId, c.seeded.entityId);
        assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.status, 'pending_approval');
        assert.equal(row.decidedByUserId, null); assert.equal(row.decidedAt, null); assert.equal(row.effectiveDate, today());
        const changes = proposedProfile(c.marker, c.rank); const { government } = await runtime();
        assert.deepEqual(JSON.parse(government.decryptGovernmentId(row.profileEnvelope)), changes);
        assert.ok(!row.profileEnvelope.includes(changes.legalName)); assert.deepEqual(row.changedFields, Object.keys(changes));
        assert.deepEqual(response.json, { id: row.id, status: 'pending_approval' });
        assert.deepEqual(after.requests.filter(item => item.id !== row.id), before.requests);
        const event = auditAdded(before, after, c, 'Employer profile change requested');
        assert.equal(event.resource, String(c.seeded.entityId));
        assert.deepEqual(event.metadata, { requestId: row.id, changedFields: Object.keys(changes), makerUserId: c.owner.id, valuesRedacted: true });
      } },
    { key: "PATCH multi-entity/registration-changes", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED", "MULTI_ENTITY_REGISTRATIONS_ENABLED"],
      seed: async e => {
        const { db, schema: s } = await runtime();
        const [maker] = await db.insert(s.users).values({ email: (e.marker + '-maker@example.invalid').toLowerCase(),
          name: e.marker + ' fictional independent maker', role: 'owner', localPasswordEnabled: false,
          passwordHash: 'synthetic-only-no-login' }).returning();
        await db.insert(s.userOrganizations).values({ organizationId: e.org.id, userId: maker.id, role: 'owner', active: true });
        const rejectEntity = await newEntity(e, '-REJ'), approveEntity = await newEntity(e, '-APP'), selfEntity = await newEntity(e, '-SELF');
        for (const entity of [rejectEntity, approveEntity]) await grant(e, entity.id, maker.id);
        const changes = proposedProfile(e.marker + '-APP', e.rank);
        const reject = await pendingRequest(e, rejectEntity, maker.id, proposedProfile(e.marker + '-REJ', e.rank));
        const approve = await pendingRequest(e, approveEntity, maker.id, changes);
        const self = await pendingRequest(e, selfEntity, e.owner.id, proposedProfile(e.marker + '-SELF', e.rank));
        return { ...reject, approve, self, makerId: maker.id, changes };
      },
      query: entityQuery, state: state,
      ownBody: c => ({ organizationId: c.orgId, legalEntityId: c.seeded.entityId, requestId: c.seeded.id, action: 'reject' }),
      foreignBody: c => ({ organizationId: c.victim.org.id, legalEntityId: c.victimSeeded.entityId, requestId: c.victimSeeded.id, action: 'reject' }),
      forged: { status: 409, body: c => ({ organizationId: c.orgId, legalEntityId: c.seeded.entityId, requestId: c.victimSeeded.id, action: 'reject' }) },
      expect: (before, after, c, response) => {
        retained(before, after, ['requests', 'audits']);
        const row = changedRequest(before, after, c, c.seeded.id, c.seeded.entityId, 'rejected');
        assert.deepEqual(response.json, { id: row.id, status: 'rejected', revision: null });
        const event = auditAdded(before, after, c, 'Employer profile change rejected');
        assert.deepEqual(event.metadata, { requestId: row.id, revision: null, changedFields: row.changedFields,
          makerUserId: c.seeded.makerId, checkerUserId: c.owner.id, sensitiveValuesRedacted: true });
      },
      exercise: async (c, io) => {
        const url = entityId => '/api/multi-entity/registration-changes?legalEntityId=' + entityId;
        const body = (orgId, target) => ({ organizationId: orgId, legalEntityId: target.entityId, requestId: target.id, action: 'approve' });
        const before = await state(c.orgId), victimBefore = await state(c.victim.org.id);
        const owned = io.expectStatus(await io.request(url(c.seeded.approve.entityId), { method: 'PATCH', cookie: io.cookie,
          body: body(c.orgId, c.seeded.approve) }), 200, 'independent registration approval');
        const after = await state(c.orgId); await proveApproval(before, after, c, owned);
        if (firstApproval) await assert.rejects(() => proveApproval(firstApproval.before, firstApproval.after, c, firstApproval.response), "approve proof accepts another employer's data");
        else firstApproval = { before, after, response: owned };
        const foreign = io.expectStatus(await io.request(url(c.victimSeeded.approve.entityId), { method: 'PATCH', cookie: io.cookie,
          body: body(c.victim.org.id, c.victimSeeded.approve) }), 403, 'foreign registration approval');
        assert.ok(!foreign.text.includes(c.victim.marker));
        io.expectStatus(await io.request(url(c.seeded.approve.entityId), { method: 'PATCH', cookie: io.cookie,
          body: { ...body(c.orgId, c.seeded.approve), requestId: c.victimSeeded.approve.id } }), 409, 'foreign approval request');
        io.expectStatus(await io.request(url(c.seeded.self.entityId), { method: 'PATCH', cookie: io.cookie,
          body: body(c.orgId, c.seeded.self) }), 409, 'maker cannot self approve');
        io.expectStatus(await io.request(url(c.seeded.approve.entityId), { method: 'PATCH', cookie: io.cookie,
          body: body(c.orgId, c.seeded.approve) }), 409, 'approval cannot be replayed');
        assert.deepEqual(await state(c.orgId), after); assert.deepEqual(await state(c.victim.org.id), victimBefore);
        return { ownAndForeignPairs: 1, approvalDiscrimination: c.orgId !== firstApproval.before.entities[0]?.organizationId ? 1 : 0,
          controls: ['approve', 'foreign-request-denied', 'self-approval-denied', 'replay-denied'] };
      } },
  ];
}
