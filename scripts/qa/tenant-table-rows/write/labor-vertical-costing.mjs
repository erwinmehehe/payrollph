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
  const request = async (url, options) =>
    (await import("../../tenant-table-http.mjs")).standaloneRequest(url, options);
  const actorCookies = new Map();
  const api = "/api/workforce/labor-costing";
  const dataOnly = (rows) => JSON.parse(JSON.stringify(rows));
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
    { key: "POST workforce/labor-costing", status: 201, state: state,
      seed: async e => {
        const { employeeLaborAllocations } = await tables();
        actorCookies.set(e.org.id, e.cookie);
        // Exercise both independent administrative POST branches with a real
        // authenticated same-employer success before the victim snapshot.
        const create = async suffix => {
          const reply = await request(api, { method: "POST", cookie: e.cookie,
            body: { organizationId: e.org.id, action: "create_cost_center",
              code: (e.marker + "-" + suffix).slice(0, 40),
              name: e.marker + " fictional " + suffix + " cost center" } });
          assert.equal(reply.status, 201, "own cost-center POST must succeed: " + reply.text.slice(0, 140));
          assert.equal(reply.json?.costCenter?.organizationId, e.org.id);
          assert.ok(Number.isSafeInteger(reply.json.costCenter.id));
          return reply.json.costCenter;
        };
        const first = await create("BPO");
        const second = await create("PLANT");
        const mapping = await request(api, { method: "POST", cookie: e.cookie,
          body: { organizationId: e.org.id, action: "set_gl_mapping",
            accountKey: "salary_expense", costCenterId: first.id,
            accountCode: "EXP511", accountName: e.marker + " fictional expense account" } });
        assert.equal(mapping.status, 201, "own GL mapping POST must succeed: " + mapping.text.slice(0, 140));
        assert.equal(mapping.json?.glMapping?.organizationId, e.org.id);
        assert.equal(mapping.json.glMapping.costCenterId, first.id);
        assert.equal(mapping.json.glMapping.accountName, e.marker + " fictional expense account");
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
      expect: async (before, after, c, response) => {
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
        const cookie = actorCookies.get(c.orgId);
        assert.ok(cookie && cookie.startsWith("__Host-linaw_session="),
          "foreign attack must use the still-authenticated attacker session");
        // The modified GET must actually return this tenant's stored vertical
        // labels to the same signed-in user, without returning victim records.
        const ownRead = await request(api + "?organizationId=" + c.orgId, { cookie });
        assert.equal(ownRead.status, 200, "own GET must return its persisted costing labels");
        assert.ok(Array.isArray(ownRead.json?.allocations));
        for (const row of added) {
          const returned = ownRead.json.allocations.find(item => item.id === row.id);
          assert.ok(returned && returned.employeeId === c.workerId && returned.organizationId === c.orgId);
          assert.deepEqual(returned.verticalDimensions, row.verticalDimensions,
            "GET must return the actual own normalized vertical tags");
        }
        assert.ok(!ownRead.text.includes(c.victim.marker), "GET must not reveal victim labels");
        const foreignRead = await request(api + "?organizationId=" + c.victim.org.id, { cookie });
        assert.equal(foreignRead.status, 403, "foreign GET must deny the real victim employer");
        assert.ok(!foreignRead.text.includes(c.victim.marker), "foreign GET must not reveal victim labels");
        // The real higher-ID victim is explicitly targeted for each other POST
        // action. Every denial is checked against the full own SQL snapshot.
        for (const action of ["create_cost_center", "set_gl_mapping"]) {
          const foreignBody = action === "create_cost_center"
            ? { organizationId: c.victim.org.id, action,
                code: c.marker + "-DENY", name: c.marker + " denied foreign center" }
            : { organizationId: c.victim.org.id, action,
                accountKey: "salary_expense", costCenterId: c.victimSeeded.id,
                accountCode: "DENY", accountName: c.marker + " denied foreign mapping" };
          const denied = await request(api, { method: "POST", cookie, body: foreignBody });
          assert.equal(denied.status, 403, action + " must deny a different employer");
          assert.ok(!denied.text.includes(c.victim.marker), action + " must not leak victim data");
          assert.deepEqual(dataOnly(await state(c.orgId)), after,
            action + " foreign denial must not mutate the attacker's own rows or audit");
        }
        const forgedMapping = await request(api, { method: "POST", cookie,
          body: { organizationId: c.orgId, action: "set_gl_mapping",
            accountKey: "salary_expense", costCenterId: c.victimSeeded.id,
            accountCode: "DENY", accountName: c.marker + " forged foreign cost center" } });
        assert.equal(forgedMapping.status, 422, "victim cost center must be refused in own-employer GL mapping");
        assert.ok(!forgedMapping.text.includes(c.victim.marker));
        assert.deepEqual(dataOnly(await state(c.orgId)), after,
          "forged cross-employer GL mapping must leave the own employer unchanged");
      } },
  ];
}
