// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "PATCH delegations": 1,
  "PATCH tenant-modules": 2
};

export function createRows({ approvalDelegations, asc, assert, db, eq, organizationModuleSettings }) {
  return [
  { key: "PATCH delegations",
    seed: async (e) => (await db.insert(approvalDelegations).values({ organizationId: e.org.id, fromApprover: e.marker, toApprover: e.marker + "-TO",
      startsOn: "2026-01-01", endsOn: "2026-12-31" }).returning())[0],
    state: (orgId) => db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, orgId)).orderBy(asc(approvalDelegations.id)),
    ownBody: (c) => ({ id: c.seeded.id, active: false }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, active: false }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own delegation is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.fromApprover, c.marker);
      assert.equal(row.active, false, "the own delegation is revoked");
    } },
  { key: "PATCH tenant-modules", flags: ["CORE_MODULE_NAVIGATION_ENABLED"],
    // A distinct module list per employer; the write must add exactly "spend" to the own list.
    seed: async (e) => {
      const modules = { ATTA: ["workforce"], ATTB: ["workforce", "planning"], VICTIM: ["it", "automation"] }[e.label];
      await db.update(organizationModuleSettings).set({ enabledModules: modules }).where(eq(organizationModuleSettings.id, e.org.id));
      return modules;
    },
    state: (orgId) => db.select({ id: organizationModuleSettings.id, enabledModules: organizationModuleSettings.enabledModules })
      .from(organizationModuleSettings).where(eq(organizationModuleSettings.id, orgId)),
    ownBody: (c) => ({ organizationId: c.orgId, moduleId: "spend", enabled: true }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, moduleId: "spend", enabled: true }),
    expect: (before, after, c) => {
      assert.deepEqual([...after[0].enabledModules].sort(), [...c.seeded, "spend"].sort(), "the own module list gains exactly spend");
    } },
  ];
}
