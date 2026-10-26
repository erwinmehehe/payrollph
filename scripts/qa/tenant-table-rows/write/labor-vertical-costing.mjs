/**
 * #188 - strictly fictional employee labor-cost allocations, never payroll execution.
 * These POSTs only create future-dated cost labels in a disposable local PG16 DB.
 * Shared runner enforces two independent logged-in employers, higher-ID victim,
 * genuine success/denial, forged worker refusal and unchanged victim SQL/audit.
 */
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, auditEvents, auditBusinessSnapshot,
  employees, employeePayProfiles, employeePayRevisions, payrollRuns, payrollEntries }) {
  let schema;
  const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));
  const scoped = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => {
    const { costCenters, employeeLaborAllocations, laborGlMappings } = await tables();
    return {
      centers: await scoped(costCenters, orgId),
      allocations: await scoped(employeeLaborAllocations, orgId),
      mappings: await scoped(laborGlMappings, orgId),
      workers: await scoped(employees, orgId),
      profiles: await scoped(employeePayProfiles, orgId),
      revisions: await scoped(employeePayRevisions, orgId),
      runs: await scoped(payrollRuns, orgId),
      entries: await db.select({ entry: payrollEntries }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollEntries.payrollRunId))
        .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
      audits: auditBusinessSnapshot(await scoped(auditEvents, orgId)),
    };
  };
  const body = (c, organizationId, employeeId, ids) => ({
    organizationId,
    action: "set_employee_allocations",
    employeeId,
    effectiveFrom: "2099-03-15",
    allocationBasis: "percentage",
    reason: c.marker + " fictional vertical costing, no payroll execution",
    allocations: [
      { costCenterId: ids.id, allocationPercent: 60,
        verticalDimensions: { campaignCode: c.marker + "-CAMP", siteCode: "HQ", teamCode: "TEAM1" } },
      { costCenterId: ids.secondId, allocationPercent: 40,
        verticalDimensions: { plantCode: c.marker + "-PLANT", shiftCode: "NIGHT", propertyCode: c.marker + "-HOTEL" } },
    ],
  });
  return [
    { key: "POST workforce/labor-costing", status: 201, state,
      seed: async e => {
        const { costCenters, employeeLaborAllocations } = await tables();
        const [first, second] = await db.insert(costCenters).values([
          { organizationId: e.org.id, code: (e.marker + "-BPO").slice(0, 40),
            name: e.marker + " fictional campaign cost center", active: true },
          { organizationId: e.org.id, code: (e.marker + "-PLANT").slice(0, 40),
            name: e.marker + " fictional plant cost center", active: true },
        ]).returning();
        const [old] = await db.insert(employeeLaborAllocations).values({
          organizationId: e.org.id, employeeId: e.worker.id, costCenterId: first.id,
          effectiveFrom: "2098-01-01", allocationPercent: "100.000",
          allocationBasis: "percentage", verticalDimensions: null,
          reason: e.marker + " fictional prior allocation", createdBy: e.owner.name,
        }).returning();
        return { id: first.id, secondId: second.id, oldId: old.id };
      },
      ownBody: c => body(c, c.orgId, c.workerId, c.seeded),
      foreignBody: c => body(c, c.victim.org.id, c.victim.worker.id, c.victimSeeded),
      forged: { status: 404,
        body: c => body(c, c.orgId, c.victim.worker.id, c.seeded) },
      expect: (before, after, c, response) => {
        assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
        for (const key of Object.keys(before))
          if (!["allocations", "audits"].includes(key)) assert.deepEqual(after[key], before[key],
            key + " must not change during a fictional allocation POST");
        assert.ok(before.profiles.some(r => r.employeeId === c.workerId && r.organizationId === c.orgId),
          "must preserve an actual own worker pay profile, not an empty snapshot");
        assert.equal(after.allocations.length, before.allocations.length + 2);
        const prior = before.allocations.find(r => r.id === c.seeded.oldId);
        const closed = after.allocations.find(r => r.id === c.seeded.oldId);
        assert.ok(prior && closed && prior.effectiveUntil === null);
        assert.equal(closed.effectiveUntil, "2099-03-14");
        const withoutChanged = ({ effectiveUntil: _end, updatedAt: _updated, ...rest }) => rest;
        assert.deepEqual(withoutChanged(closed), withoutChanged(prior));
        const added = after.allocations.filter(r => !before.allocations.some(x => x.id === r.id));
        assert.equal(added.length, 2);
        assert.deepEqual(added.map(r => r.organizationId), [c.orgId, c.orgId]);
        assert.deepEqual(added.map(r => r.employeeId), [c.workerId, c.workerId]);
        assert.deepEqual(added.map(r => r.costCenterId), [c.seeded.id, c.seeded.secondId]);
        assert.deepEqual(added.map(r => r.effectiveFrom), ["2099-03-15", "2099-03-15"]);
        assert.deepEqual(added.map(r => r.allocationPercent), ["60.000", "40.000"]);
        assert.deepEqual(added.map(r => r.allocationBasis), ["percentage", "percentage"]);
        assert.deepEqual(added.map(r => r.verticalDimensions), [
          { campaignCode: (c.marker + "-CAMP").toUpperCase(), siteCode: "HQ", teamCode: "TEAM1" },
          { plantCode: (c.marker + "-PLANT").toUpperCase(), shiftCode: "NIGHT",
            propertyCode: (c.marker + "-HOTEL").toUpperCase() },
        ], "the persisted nine-dimension JSONB payload must be tenant-discriminating");
        assert.ok(added.every(r => r.createdBy === c.owner.name));
        assert.deepEqual(after.allocations.filter(r => !added.some(a => a.id === r.id)),
          before.allocations.map(r => r.id === c.seeded.oldId ? closed : r));
        assert.deepEqual(response.json?.allocations, added, "own POST response must echo persisted own DB rows");
        assert.equal(after.audits.length, before.audits.length + 1);
        const event = after.audits.find(r => !before.audits.some(old => old.id === r.id));
        assert.ok(event && event.organizationId === c.orgId);
        assert.equal(event.actor, c.owner.name);
        assert.equal(event.action, "Employee labor allocation set");
        assert.ok(event.resource.includes(c.marker));
        assert.equal(event.metadata.employeeId, c.workerId);
        assert.equal(event.metadata.effectiveFrom, "2099-03-15");
        assert.deepEqual(event.metadata.closedAllocationIds, [c.seeded.oldId]);
        assert.deepEqual(event.metadata.allocations.map(r => r.verticalDimensions),
          added.map(r => r.verticalDimensions));
        assert.deepEqual(after.audits.filter(r => r.id !== event.id), before.audits);
      } },
  ];
}
