// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "PATCH performance/development-plans": 12
};

export function createRows({ asc, assert, db, eq, hcmSkills, performanceSkillDevelopmentPlans }) {
  return [
  { key: "PATCH performance/development-plans",
    seed: async (e) => {
      const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-DP", name: e.marker }).returning();
      return (await db.insert(performanceSkillDevelopmentPlans).values({ organizationId: e.org.id, employeeId: e.worker.id, skillId: skill.id,
        title: e.marker, objective: "Fictional objective " + e.marker, targetProficiency: "4.00", targetDate: "2026-12-31", createdByName: e.marker }).returning())[0];
    },
    state: (orgId) => db.select().from(performanceSkillDevelopmentPlans).where(eq(performanceSkillDevelopmentPlans.organizationId, orgId)).orderBy(asc(performanceSkillDevelopmentPlans.id)),
    ownBody: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.seeded.id, status: "in_progress" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.title === c.marker, "the own plan is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "in_progress");
    } },
  ];
}
