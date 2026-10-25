// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET workforce/labor-costing": 17,
  "GET workforce/overtime": 18,
  "GET workforce/schedule-guardrails": 40,
  "GET workforce/schedule-swaps": 41,
  "GET workforce/worksites": 42,
  "GET workforce/attendance-corrections": 62,
  "GET workforce/live-floor": 64,
  "GET workforce/schedules": 65,
  "GET workforce/timesheets": 67,
  "GET workforce/team-roster": 68,
  "GET workforce/coverage": 69
};

export function createRows({ addWorker, assert, attendanceCorrectionRequests, count, db, employees, eq, proofs, scheduleSwapRequests, shiftDefinitions, timePunches, workforceScheduleGuardrailPolicies, worksites }) {
  return [
  { key: "GET workforce/labor-costing", prove: proofs.listsOwnMarker("legalEntities", "legalName") },
  { key: "GET workforce/overtime", prove: proofs.listsOwnMarker("managers", "name") },
  { key: "GET workforce/schedule-guardrails",
    // A distinct configured rest minimum per employer.
    seed: async (e) => {
      const minimumRestMinutes = 600 + 10 * e.rank;
      await db.insert(workforceScheduleGuardrailPolicies).values({ organizationId: e.org.id, minimumRestMinutes, updatedBy: e.marker });
      return minimumRestMinutes;
    },
    prove: proofs.equalsOwnSeed("policy.minimumRestMinutes") },
  { key: "GET workforce/schedule-swaps",
    seed: async (e) => {
      const counterparty = await addWorker(e, "SWAP");
      await db.insert(scheduleSwapRequests).values({ organizationId: e.org.id, requesterEmployeeId: e.worker.id,
        counterpartyEmployeeId: counterparty.id, requesterWorkDate: "2026-03-03", counterpartyWorkDate: "2026-03-04",
        requesterScheduleSnapshot: {}, counterpartyScheduleSnapshot: {}, reason: e.marker, requestedBy: e.marker, requestedByUserId: e.owner.id });
    },
    prove: proofs.listsOwnMarker("swaps", "reason") },
  { key: "GET workforce/worksites",
    seed: (e) => db.insert(worksites).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("worksites", "name") },
  { key: "GET workforce/attendance-corrections",
    seed: async (e) => {
      const [punch] = await db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id, workDate: "2026-03-02" }).returning();
      await db.insert(attendanceCorrectionRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, punchId: punch.id, workDate: "2026-03-02",
        originalPunchSnapshot: {}, proposedPunchSnapshot: {}, reason: e.marker, requestedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("requests", "reason") },
  { key: "GET workforce/live-floor",
    // A different employee head count per employer: the floor must count exactly the own employer's workers.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "LF" + i); },
    prove: async (r, c) => {
      const own = Number((await db.select({ n: count() }).from(employees).where(eq(employees.organizationId, c.orgId)))[0].n);
      assert.notEqual(own, Number((await db.select({ n: count() }).from(employees).where(eq(employees.organizationId, c.victim.org.id)))[0].n),
        "seeded head counts must differ between employers");
      assert.equal(r.json?.totalEmployees, own, "the live floor must count the own employer's workers");
    } },
  { key: "GET workforce/schedules",
    seed: (e) => db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: e.marker.slice(0, 32), name: e.marker, startTime: "09:00", endTime: "18:00" }),
    prove: proofs.listsOwnMarker("shifts", "name") },
  { key: "GET workforce/timesheets", query: () => "periodStart=2026-03-01&periodEnd=2026-03-15", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET workforce/team-roster", query: () => "startDate=2026-03-02", prove: proofs.listsOwnMarkerAt("rows", "employee.name") },
  { key: "GET workforce/coverage", query: () => "startDate=2026-03-02&endDate=2026-03-08", prove: proofs.listsOwnMarker("employees", "name") },
  ];
}
