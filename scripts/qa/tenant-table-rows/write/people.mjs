// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST discipline": 0
};

export function createRows({ asc, assert, db, disciplinaryCases, eq }) {
  return [
  { key: "POST discipline", status: 201,
    state: (orgId) => db.select().from(disciplinaryCases).where(eq(disciplinaryCases.organizationId, orgId)).orderBy(asc(disciplinaryCases.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, employeeId: c.victim.worker.id, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }) },
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one case is created");
      const row = after.find((r) => r.offense === c.marker);
      assert.ok(row, "the created case carries the own marker");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "nte_issued");
    } },
  ];
}
