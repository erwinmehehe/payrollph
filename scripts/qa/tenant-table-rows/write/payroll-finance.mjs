// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "PATCH earned-wage": 4
};

export function createRows({ asc, assert, db, earnedWageRequests, eq }) {
  return [
  { key: "PATCH earned-wage",
    seed: async (e) => (await db.insert(earnedWageRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, requestedAmount: "100.00" }).returning())[0],
    state: (orgId) => db.select().from(earnedWageRequests).where(eq(earnedWageRequests.organizationId, orgId)).orderBy(asc(earnedWageRequests.id)),
    ownBody: (c) => ({ id: c.seeded.id, status: "approved" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, status: "approved" }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own request is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "approved");
    } },
  ];
}
