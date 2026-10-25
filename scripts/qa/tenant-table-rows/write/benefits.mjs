// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST benefits": 9,
  "DELETE benefits": 10
};

export function createRows({ asc, assert, benefitEnrollments, benefitPlans, db, eq }) {
  return [
  { key: "POST benefits", status: 201,
    seed: async (e) => (await db.insert(benefitPlans).values({ organizationId: e.org.id, name: e.marker + " plan", category: "voluntary" }).returning())[0],
    state: (orgId) => db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, orgId)).orderBy(asc(benefitEnrollments.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.workerId, planId: c.seeded.id, monthlyContribution: 100, startedOn: "2026-03-02" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.workerId, planId: c.seeded.id, monthlyContribution: 100, startedOn: "2026-03-02" }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one enrolment is created");
      const row = after.find((r) => r.employeeId === c.workerId && r.planId === c.seeded.id);
      assert.ok(row, "the created enrolment links the own worker to the own plan");
      assert.equal(row.organizationId, c.orgId);
    } },
  { key: "DELETE benefits",
    seed: async (e) => {
      const [plan] = await db.insert(benefitPlans).values({ organizationId: e.org.id, name: e.marker + " end plan", category: "voluntary" }).returning();
      return (await db.insert(benefitEnrollments).values({ organizationId: e.org.id, employeeId: e.worker.id, planId: plan.id, startedOn: "2026-01-05" }).returning())[0];
    },
    state: (orgId) => db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, orgId)).orderBy(asc(benefitEnrollments.id)),
    query: (c, target) => "id=" + (target === "own" ? c.seeded.id : c.victimSeeded.id),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own enrolment is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "ended");
    } },
  ];
}
