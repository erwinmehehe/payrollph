// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET it-operations": 6,
  "GET tenant-modules": 36,
  "GET delegations": 49
};

export function createRows({ approvalDelegations, db, eq, organizationModuleSettings, proofs }) {
  return [
  { key: "GET it-operations", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET tenant-modules", flags: ["CORE_MODULE_NAVIGATION_ENABLED"],
    // Navigation preference only (mode stays "all"); a distinct module list per employer.
    seed: async (e) => {
      const modules = { ATTA: ["workforce"], ATTB: ["workforce", "planning"], VICTIM: ["spend", "it", "automation", "enterprise"] }[e.label];
      await db.update(organizationModuleSettings).set({ enabledModules: modules }).where(eq(organizationModuleSettings.id, e.org.id));
      return modules;
    },
    prove: proofs.equalsOwnSeed("enabledModules") },
  { key: "GET delegations",
    seed: (e) => db.insert(approvalDelegations).values({ organizationId: e.org.id, fromApprover: e.marker, toApprover: e.marker + "-TO",
      startsOn: "2026-01-01", endsOn: "2026-12-31" }),
    prove: proofs.listsOwnMarker("delegations", "fromApprover") },
  ];
}
