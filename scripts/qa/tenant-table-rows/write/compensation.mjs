// Fictional catalogue creation and proposal decisions; pay changes are only scheduled for 2098, never applied.
import { seedCompensationPatch, compensationPatchActions } from "../helpers/compensation-patch-actions.mjs";
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, compensationComponents, compensationProposals, compensationBands,
  compensationCycles, employeeCompensationComponents, compensationEvents, employeePayProfiles, employeePayRevisions,
  payrollRuns, employees, auditEvents, auditBusinessSnapshot, hcmBusinessProcessInstances }) {
  const read = (table, organizationId) => db.select().from(table).where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
  const state = async orgId => ({
    components: await read(compensationComponents, orgId), proposals: await read(compensationProposals, orgId),
    bands: await read(compensationBands, orgId), cycles: await read(compensationCycles, orgId),
    assignments: await read(employeeCompensationComponents, orgId), events: await read(compensationEvents, orgId),
    payProfiles: await read(employeePayProfiles, orgId), revisions: await read(employeePayRevisions, orgId),
    runs: await read(payrollRuns, orgId), workers: await read(employees, orgId),
    reviews: await read(hcmBusinessProcessInstances, orgId), audits: auditBusinessSnapshot(await read(auditEvents, orgId)),
  });
  const unchanged = (before, after, changed) => {
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const key of Object.keys(before)) if (![changed, "audits"].includes(key)) assert.deepEqual(after[key], before[key], key + " must not change");
  };
  const audited = (before, after, c, action, resource, metadata) => {
    assert.equal(after.audits.length, before.audits.length + 1);
    const added = after.audits.filter(row => !before.audits.some(old => old.id === row.id));
    assert.equal(added.length, 1); const event = added[0];
    assert.equal(event.organizationId, c.orgId); assert.equal(event.actor, c.owner.name);
    assert.equal(event.action, action); assert.equal(event.resource, resource); assert.deepEqual(event.metadata, metadata);
    assert.deepEqual(after.audits.filter(row => row.id !== event.id), before.audits);
  };
  return [
    { key: "POST compensation", status: 201, state,
      ownBody: c => ({ organizationId: c.orgId, entityType: "component", code: c.marker + "-COMP", name: c.marker + " component", kind: "allowance", amountFrequency: "monthly", taxable: true, includeInSssBase: true, includeInPagIbigBase: true }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "component", code: c.marker + "-COMP", name: c.marker + " component", kind: "allowance", amountFrequency: "monthly", taxable: true, includeInSssBase: true, includeInPagIbigBase: true }),
      expect: (before, after, c, response) => {
        unchanged(before, after, "components");
        assert.equal(after.components.length, before.components.length + 1);
        const added = after.components.filter(row => !before.components.some(old => old.id === row.id)); assert.equal(added.length, 1);
        const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
        assert.equal(row.organizationId, c.orgId); assert.equal(row.createdByUserId, c.owner.id);
        assert.equal(row.code, (c.marker + "-COMP").toUpperCase().slice(0, 40)); assert.equal(row.name, c.marker + " component");
        assert.equal(row.kind, "allowance"); assert.equal(row.amountFrequency, "monthly");
        for (const flag of ["active", "taxable", "includeInSssBase", "includeInPagIbigBase"]) assert.equal(row[flag], true);
        assert.deepEqual(after.components.filter(item => item.id !== row.id), before.components);
        assert.deepEqual(response.json, row);
        audited(before, after, c, "Compensation component created", row.name, { componentId: row.id, code: row.code, kind: "allowance", amountFrequency: "monthly" });
      } },
    { key: "PATCH compensation", state: state,
      seed: async e => {
        const [band] = await db.insert(compensationBands).values({ organizationId: e.org.id, legalEntityId: e.entity.id,
          locationCode: e.marker, minimumAnnual: "120000.00", midpointAnnual: "240000.00", maximumAnnual: "360000.00", effectiveFrom: "2099-01-01", active: false }).returning();
        const [cycle] = await db.insert(compensationCycles).values({ organizationId: e.org.id, name: e.marker + " refusal-only cycle",
          startDate: "2099-01-01", endDate: "2099-01-31", effectiveDate: "2099-02-01", status: "draft", budgetPool: "0.00", createdByUserId: e.owner.id, createdBy: e.owner.name }).returning();
        const [proposal] = await db.insert(compensationProposals).values({ organizationId: e.org.id, employeeId: e.worker.id, bandId: band.id,
          cycleId: cycle.id, currentAnnual: "240000.00", proposedAnnual: "252000.00", reason: e.marker + " fictional refusal", status: "proposed", submittedByUserId: e.owner.id }).returning();
        return { ...proposal, extras: await seedCompensationPatch({ db }, e) };
      },
      ownBody: c => ({ entityType: "proposal", id: c.seeded.id, decision: "declined" }),
      foreignBody: c => ({ entityType: "proposal", id: c.victimSeeded.id, decision: "declined" }),
      expect: (before, after, c, response) => {
        unchanged(before, after, "proposals");
        assert.equal(after.proposals.length, before.proposals.length);
        const old = before.proposals.find(row => row.id === c.seeded.id), row = after.proposals.find(row => row.id === c.seeded.id);
        assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
        assert.equal(old.status, "proposed"); assert.equal(row.status, "declined"); assert.equal(row.employeeId, c.workerId);
        assert.equal(row.reason, c.marker + " fictional refusal"); assert.equal(row.bandId, c.seeded.bandId); assert.equal(row.cycleId, c.seeded.cycleId);
        assert.equal(row.approvedByUserId, c.owner.id); assert.ok(Number.isFinite(Date.parse(row.approvedAt)));
        for (const field of ["scheduledAt", "appliedAt", "appliedPayRevisionId"]) assert.equal(row[field], null);
        const immutable = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["status", "approvedByUserId", "approvedAt", "updatedAt"].includes(key)));
        assert.deepEqual(immutable(row), immutable(old));
        assert.deepEqual(after.proposals.filter(item => item.id !== row.id), before.proposals.filter(item => item.id !== row.id));
        assert.deepEqual(response.json, row);
        audited(before, after, c, "Compensation proposal declined", `Proposal #${row.id}`, { employeeId: c.workerId });
        assert.ok(before.payProfiles.some(profile => profile.employeeId === c.workerId && profile.organizationId === c.orgId), "existing worker pay profile must be preserved, not an empty proxy");
      },
      exercise: (c, helpers) => compensationPatchActions({ assert, state, db, eq, hcmBusinessProcessInstances, compensationProposals }, c, helpers) },
  ];
}
