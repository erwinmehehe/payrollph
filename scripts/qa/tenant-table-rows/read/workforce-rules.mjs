// Distinct configured policy per employer; defaults alone are not positive evidence.
export const fixtureOrder = {};
export function createRows({ assert, db, workforceRosterRulePolicies }) {
  return [
    { key: "GET workforce/roster-rules", profile: "flagged-reads", flags: ["WFM_ROSTER_SCALE_RULES_ENABLED"],
      seed: async e => {
        const policy = { active: false, maxDailyMinutes: 720 + 10 * e.rank, maxRollingSevenDayMinutes: 2880,
          minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480, approvedOvertimeCapMinutes: 0, enforcementMode: "advisory" };
        const [row] = await db.insert(workforceRosterRulePolicies).values({ organizationId: e.org.id, ...policy, updatedByUserId: e.owner.id }).returning();
        return { id: row.id, policy };
      },
      prove: (response, c) => { assert.equal(response.json?.configured, true); assert.deepEqual(response.json.policy, c.seeded.policy); },
    },
  ];
}
