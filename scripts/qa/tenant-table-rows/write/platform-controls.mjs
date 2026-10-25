import { createHash } from "node:crypto";
// Fictional platform records only; no provider calls or execution retries.
export const fixtureOrder = {};
export function createRows({ assert, db, eq, asc, apiKeys, organizations, organizationSecurityPolicies, automationOperationalCases,
  automationExecutions, employees, auditEvents, auditBusinessSnapshot }) {
  const state = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const audits = async orgId => auditBusinessSnapshot(await state(auditEvents, orgId));
  const updated = (before, after, c) => {
    assert.equal(after.length, before.length); const old = before.find(r => r.id === c.seeded.id), row = after.find(r => r.id === c.seeded.id);
    assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId); assert.notDeepEqual(row, old);
    assert.deepEqual(after.filter(r => r.id !== row.id), before.filter(r => r.id !== row.id)); return { old, row };
  };
  const auditAdded = (before, after, c, action) => {
    assert.equal(after.length, before.length + 1); const added = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(added.length, 1);
    const event = added[0]; assert.equal(event.organizationId, c.orgId); assert.equal(event.actor, c.owner.name); assert.equal(event.action, action);
    assert.deepEqual(after.filter(r => r.id !== event.id), before); return event;
  };
  return [
    { key: "POST developer",
      seed: async e => (await db.insert(apiKeys).values({ organizationId: e.org.id, name: e.marker, prefix: e.marker.slice(0, 16), keyHash: createHash("sha256").update(e.marker + " fictional revoke-only fixture").digest("hex"), scopes: [] }).returning())[0],
      state: async orgId => ({ keys: await state(apiKeys, orgId), audits: await audits(orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "revoke-key", keyId: c.seeded.id }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "revoke-key", keyId: c.victimSeeded.id }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "revoke-key", keyId: c.victimSeeded.id }) },
      expect: (before, after, c, response) => {
        const { old, row } = updated(before.keys, after.keys, c); assert.equal(old.revokedAt, null); assert.ok(Number.isFinite(Date.parse(row.revokedAt)));
        const { revokedAt: _old, ...oldFields } = old, { revokedAt: _new, ...newFields } = row; assert.deepEqual(newFields, oldFields);
        assert.equal(row.name, c.marker); assert.deepEqual(response.json, { ok: true });
        const event = auditAdded(before.audits, after.audits, c, "API key revoked"); assert.equal(event.resource, row.name); assert.deepEqual(event.metadata, { prefix: row.prefix });
      } },
    { key: "POST enterprise",
      state: async orgId => ({ policies: await state(organizationSecurityPolicies, orgId), audits: await audits(orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "save-security-policy", sessionIdleMinutes: 30 + c.rank, sessionMaxHours: 24, maxActiveSessions: 3, requireMfa: true, ssoMode: "optional" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "save-security-policy", sessionIdleMinutes: 30 + c.rank, sessionMaxHours: 24, maxActiveSessions: 3, requireMfa: true, ssoMode: "optional" }),
      expect: (before, after, c, response) => {
        assert.equal(before.policies.length, 0); assert.equal(after.policies.length, 1); const row = after.policies[0];
        assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(row.organizationId, c.orgId);
        assert.equal(row.sessionIdleMinutes, 30 + c.rank); assert.equal(row.sessionMaxHours, 24); assert.equal(row.maxActiveSessions, 3);
        assert.equal(row.requireMfa, true); assert.equal(row.ssoMode, "optional"); assert.equal(row.updatedByUserId, c.owner.id);
        assert.equal(response.json?.id, row.id); assert.equal(response.json?.organizationId, c.orgId);
        for (const key of ["sessionIdleMinutes", "sessionMaxHours", "maxActiveSessions", "requireMfa", "ssoMode"]) assert.equal(response.json[key], row[key]);
        const event = auditAdded(before.audits, after.audits, c, "Enterprise security policy updated");
        assert.deepEqual(event.metadata, { sessionIdleMinutes: row.sessionIdleMinutes, sessionMaxHours: 24, maxActiveSessions: 3, requireMfa: true, ssoMode: "optional" });
      } },
    { key: "POST automation-studio",
      seed: async e => (await db.insert(automationOperationalCases).values({ organizationId: e.org.id, employeeId: e.worker.id, caseType: "attendance_resolution", sourceType: "tenant_fixture", sourceId: e.worker.id, ownerTeam: "HR Operations", title: e.marker, detail: e.marker, status: "open" }).returning())[0],
      state: async orgId => ({ cases: await state(automationOperationalCases, orgId), audits: await audits(orgId), workers: await state(employees, orgId), executions: await state(automationExecutions, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "triage-operational-case", caseId: c.seeded.id, transition: "acknowledge", note: c.marker + " fictional triage note" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "triage-operational-case", caseId: c.victimSeeded.id, transition: "acknowledge", note: c.marker + " fictional triage note" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "triage-operational-case", caseId: c.victimSeeded.id, transition: "acknowledge", note: c.marker + " fictional triage note" }) },
      expect: (before, after, c, response) => {
        const { old, row } = updated(before.cases, after.cases, c); assert.equal(old.status, "open"); assert.equal(row.status, "acknowledged");
        assert.equal(row.employeeId, c.workerId); assert.equal(row.title, c.marker); assert.equal(row.acknowledgedByUserId, c.owner.id); assert.equal(row.acknowledgedByName, c.owner.name); assert.ok(Number.isFinite(Date.parse(row.acknowledgedAt)));
        const unchanged = item => Object.fromEntries(Object.entries(item).filter(([key]) => !["status", "acknowledgedByUserId", "acknowledgedByName", "acknowledgedAt", "updatedAt"].includes(key)));
        assert.deepEqual(unchanged(row), unchanged(old)); assert.deepEqual(after.workers, before.workers); assert.deepEqual(after.executions, before.executions);
        assert.equal(response.json?.operationalCase?.id, row.id); assert.equal(response.json?.operationalCase?.organizationId, c.orgId); assert.equal(response.json.sourceMutation, false); assert.equal(response.json.executionStatusUnchanged, true);
        const event = auditAdded(before.audits, after.audits, c, "Automation operations case acknowledge");
        assert.equal(event.resource, c.marker); assert.equal(event.metadata.caseId, row.id); assert.equal(event.metadata.note, c.marker + " fictional triage note");
        assert.equal(event.metadata.sourceMutation, false); assert.equal(event.metadata.underlyingExecutionStatusUnchanged, true);
      } },
    { key: "PUT organizations",
      state: async orgId => ({ organizations: await db.select().from(organizations).where(eq(organizations.id, orgId)), audits: await audits(orgId) }),
      ownBody: c => ({ organizationId: c.orgId, name: c.marker + " renamed" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, name: c.marker + " renamed" }),
      expect: (before, after, c, response) => {
        assert.equal(before.organizations.length, 1); assert.equal(after.organizations.length, 1);
        const old = before.organizations[0], row = after.organizations[0]; assert.equal(old.id, c.orgId); assert.equal(row.id, c.orgId); assert.notEqual(old.name, row.name); assert.equal(row.name, c.marker + " renamed");
        const { name: _old, ...oldFields } = old, { name: _new, ...newFields } = row; assert.deepEqual(newFields, oldFields);
        assert.equal(response.json?.ok, true); assert.equal(response.json?.organization?.id, c.orgId); assert.equal(response.json.organization.name, row.name);
        const event = auditAdded(before.audits, after.audits, c, "Organization profile updated"); assert.equal(event.resource, row.name);
        assert.equal(event.metadata.legalName, old.legalName); assert.equal(event.metadata.statutoryDeductionTiming, old.statutoryDeductionTiming); assert.equal(event.metadata.payrollCalendarMode, old.payrollCalendarMode); assert.deepEqual(event.metadata.governmentFieldsUpdated, []);
      } },
  ];
}
