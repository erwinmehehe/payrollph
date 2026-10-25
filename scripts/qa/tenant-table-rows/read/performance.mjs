// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET performance/calibration": 9,
  "GET performance/continuous": 10,
  "GET performance/development-plans": 11,
  "GET performance": 12,
  "GET performance/talent-continuity": 13,
  "GET performance/competencies": 34,
  "GET performance/follow-through-governance": 35,
  "GET performance/analytics": 59
};

export function createRows({ db, hcmSkills, performanceCycles, proofs }) {
  return [
  { key: "GET performance/calibration", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET performance/continuous",
    prove: proofs.all(proofs.echoesOrganization("access.organizationId"), proofs.listsOwnMarker("employees", "lastName")) },
  { key: "GET performance/development-plans", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET performance",
    prove: proofs.all(proofs.echoesOrganization("access.organizationId"), proofs.listsOwnMarker("employees", "lastName"), proofs.listsOwnMarker("orgUnits", "name")) },
  { key: "GET performance/talent-continuity", prove: proofs.listsOwnMarker("employees", "label") },
  { key: "GET performance/competencies",
    seed: (e) => db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("skills", "name") },
  { key: "GET performance/follow-through-governance",
    seed: (e) => db.insert(performanceCycles).values({ organizationId: e.org.id, name: e.marker, startDate: "2026-01-01", endDate: "2026-06-30" }),
    prove: proofs.listsOwnMarker("cycles", "name") },
  { key: "GET performance/analytics", query: (c) => "cycleId=" + c.seeded.id,
    seed: async (e) => (await db.insert(performanceCycles).values({ organizationId: e.org.id, name: e.marker + " analytics",
      startDate: "2026-01-01", endDate: "2026-12-31", status: "active" }).returning())[0],
    prove: proofs.valueHasOwnMarker("cycle.name") },
  ];
}
