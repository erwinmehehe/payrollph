export const fixtureOrder = {};
export function createRows({ assert, db, eq, asc, employeeMweClassifications, employees, auditEvents, auditBusinessSnapshot,
  employeePayProfiles, employeePayRevisions, payrollRuns, payrollEntries }) {
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const body = c => ({ organizationId: c.orgId, employeeId: c.workerId, isMwe: false, region: "NCR",
    employeeDailyWage: 1000 + c.rank, statutoryMinimumWage: 600, wageOrderReference: "FICTIONAL-" + c.marker,
    evidenceReference: c.marker, effectiveFrom: "2026-07-01" });
  return [
    { key: "POST employees/[id]/mwe-classifications", status: 201, pathIds: { id: "id" },
      seed: e => e.worker,
      state: async orgId => ({ classifications: await read(employeeMweClassifications, orgId), workers: await read(employees, orgId),
        profiles: await read(employeePayProfiles, orgId), revisions: await read(employeePayRevisions, orgId), runs: await read(payrollRuns, orgId),
        entries: await db.select({ entry: payrollEntries }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
          .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)), audits: auditBusinessSnapshot(await read(auditEvents, orgId)) }),
      ownBody: c => body(c), foreignBody: c => ({ ...body(c), organizationId: c.victim.org.id, employeeId: c.victim.worker.id }),
      forged: { status: 403, body: c => body(c) },
      expect: (before, after, c, response) => {
        for (const field of ["workers", "profiles", "revisions", "runs", "entries"]) assert.deepEqual(after[field], before[field], field + " unchanged");
        assert.equal(after.classifications.length, before.classifications.length + 1);
        const added = after.classifications.filter(row => !before.classifications.some(old => old.id === row.id)); assert.equal(added.length, 1);
        const row = added[0]; assert.deepEqual(after.classifications.filter(item => item.id !== row.id), before.classifications);
        assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId); assert.equal(row.isMwe, false);
        assert.equal(row.status, "pending"); assert.equal(row.region, "NCR"); assert.equal(Number(row.employeeDailyWage), 1000 + c.rank);
        assert.equal(Number(row.statutoryMinimumWage), 600); assert.equal(row.wageOrderReference, "FICTIONAL-" + c.marker);
        assert.equal(row.evidenceReference, c.marker); assert.equal(row.effectiveFrom, "2026-07-01"); assert.equal(row.effectiveUntil, null);
        assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.requestedByName, c.owner.name);
        for (const field of ["decidedByUserId", "decidedByName", "decidedAt", "decisionNote"]) assert.equal(row[field], null);
        assert.deepEqual(response.json.classification, row);
        assert.equal(after.audits.length, before.audits.length + 1);
        const event = after.audits.find(event => !before.audits.some(old => old.id === event.id)); assert.ok(event);
        assert.deepEqual(after.audits.filter(item => item.id !== event.id), before.audits);
        assert.equal(event.organizationId, c.orgId); assert.equal(event.actor, c.owner.name); assert.equal(event.action, "MWE classification submitted for review");
        assert.ok(event.resource.includes(c.marker)); assert.deepEqual(event.metadata, { classificationId: row.id, employeeId: c.workerId,
          isMwe: false, region: "NCR", employeeDailyWage: row.employeeDailyWage, statutoryMinimumWage: row.statutoryMinimumWage,
          wageOrderReference: row.wageOrderReference, evidenceReference: c.marker, effectiveFrom: "2026-07-01", effectiveUntil: null, requestedByUserId: c.owner.id });
      } },
  ];
}
