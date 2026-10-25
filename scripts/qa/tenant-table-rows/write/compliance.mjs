// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST compliance/data-requests": 3
};

export function createRows({ asc, assert, dataRequests, db, eq }) {
  return [
  { key: "POST compliance/data-requests", status: 201,
    state: (orgId) => db.select().from(dataRequests).where(eq(dataRequests.organizationId, orgId)).orderBy(asc(dataRequests.id)),
    ownBody: (c) => ({ organizationId: c.orgId, subjectEmail: c.marker + "@example.invalid", requestType: "access" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, subjectEmail: c.marker + "@example.invalid", requestType: "access" }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one data-subject request is created");
      const row = after.find((r) => r.subjectEmail === (c.marker + "@example.invalid").toLowerCase());
      assert.ok(row, "the created request carries the own marker");
      assert.equal(row.organizationId, c.orgId);
    } },
  ];
}
