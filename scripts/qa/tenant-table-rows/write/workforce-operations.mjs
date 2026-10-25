// Fictional pending requests/configuration only. No request is approved or applied.
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, addWorker, shiftDefinitions, timePunches, attendanceCorrectionRequests,
  overtimeRequests, employeeAvailabilityRules, scheduleSwapRequests, schedulePatterns, schedulePatternDays, schedulePatternSegments,
  employeeScheduleAssignments, scheduleOverrides, workforceScheduleGuardrailPolicies, workforceRosterRulePolicies, auditEvents, auditBusinessSnapshot }) {
  const state = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const added = (before, after, c, payload) => {
    assert.equal(after.length, before.length + 1);
    const rows = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(rows.length, 1); const row = rows[0];
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(row.organizationId, c.orgId);
    assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    assert.deepEqual(after.filter(r => r.id !== row.id), before); return row;
  };
  const policyState = async (table, orgId) => ({ policies: await state(table, orgId), audits: auditBusinessSnapshot(await state(auditEvents, orgId)) });
  const newPolicy = (before, after, c, action) => {
    assert.equal(before.policies.length, 0); assert.equal(after.policies.length, 1); const row = after.policies[0];
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(row.organizationId, c.orgId);
    assert.equal(after.audits.length, before.audits.length + 1);
    const audits = after.audits.filter(r => !before.audits.some(old => old.id === r.id)); assert.equal(audits.length, 1);
    assert.deepEqual(after.audits.filter(r => r.id !== audits[0].id), before.audits);
    assert.equal(audits[0].organizationId, c.orgId); assert.equal(audits[0].actor, c.owner.name); assert.equal(audits[0].action, action);
    return { row, audit: audits[0] };
  };
  return [
    { key: "POST workforce/schedules", status: 201,
      state: orgId => state(shiftDefinitions, orgId),
      ownBody: c => ({ organizationId: c.orgId, action: "create_shift", code: c.marker.toUpperCase() + "-NEW", name: c.marker, startTime: "09:00", endTime: "18:00", breakMinutes: 60 }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "create_shift", code: c.marker.toUpperCase() + "-NEW", name: c.marker, startTime: "09:00", endTime: "18:00", breakMinutes: 60 }),
      expect: (before, after, c, response) => {
        const row = added(before, after, c, response.json?.shift); assert.equal(row.code, c.marker.toUpperCase() + "-NEW"); assert.equal(row.name, c.marker);
        assert.equal(row.startTime, "09:00"); assert.equal(row.endTime, "18:00"); assert.equal(row.breakMinutes, 60); assert.equal(row.spansMidnight, false);
      } },
    { key: "POST workforce/overtime", status: 201,
      state: orgId => state(overtimeRequests, orgId),
      ownBody: c => ({ organizationId: c.orgId, action: "create_request", employeeId: c.workerId, workDate: "2099-03-03", requestedMinutes: 60, requestKind: "pre_approved", reason: c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "create_request", employeeId: c.victim.worker.id, workDate: "2099-03-03", requestedMinutes: 60, requestKind: "pre_approved", reason: c.marker }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "create_request", employeeId: c.victim.worker.id, workDate: "2099-03-03", requestedMinutes: 60, requestKind: "pre_approved", reason: c.marker }) },
      expect: (before, after, c, response) => {
        const row = added(before, after, c, response.json?.request); assert.equal(row.employeeId, c.workerId); assert.equal(row.workDate, "2099-03-03");
        assert.equal(row.requestedMinutes, 60); assert.equal(row.requestKind, "pre_approved"); assert.equal(row.reason, c.marker);
        assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.requestedBy, c.owner.name); assert.equal(row.status, "pending"); assert.equal(row.decidedAt, null);
      } },
    { key: "POST workforce/attendance-corrections", status: 201,
      seed: async e => (await db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id, workDate: "2026-03-03",
        timeIn: new Date("2026-03-03T09:00:00Z"), timeOut: new Date("2026-03-03T18:00:00Z"), status: "Complete", notes: e.marker }).returning())[0],
      state: async orgId => ({ corrections: await state(attendanceCorrectionRequests, orgId), punches: await state(timePunches, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "create_request", punchId: c.seeded.id, proposedTimeIn: "2026-03-03T08:45:00Z", reason: c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "create_request", punchId: c.victimSeeded.id, proposedTimeIn: "2026-03-03T08:45:00Z", reason: c.marker }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "create_request", punchId: c.victimSeeded.id, proposedTimeIn: "2026-03-03T08:45:00Z", reason: c.marker }) },
      expect: (before, after, c, response) => {
        const row = added(before.corrections, after.corrections, c, response.json?.correction); assert.deepEqual(after.punches, before.punches);
        assert.equal(row.employeeId, c.workerId); assert.equal(row.punchId, c.seeded.id); assert.equal(row.workDate, "2026-03-03"); assert.equal(row.reason, c.marker);
        const original = { workDate: "2026-03-03", timeIn: "2026-03-03T09:00:00.000Z", timeOut: "2026-03-03T18:00:00.000Z", breakStart: null, breakEnd: null, status: "Complete" };
        assert.deepEqual(row.originalPunchSnapshot, original); assert.deepEqual(row.proposedPunchSnapshot, { ...original, timeIn: "2026-03-03T08:45:00.000Z" });
        assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.status, "pending"); assert.equal(row.decidedAt, null); assert.equal(row.appliedAt, null);
      } },
    { key: "POST workforce/coverage", status: 201,
      state: orgId => state(employeeAvailabilityRules, orgId),
      ownBody: c => ({ organizationId: c.orgId, action: "create_availability", employeeId: c.workerId, weekday: 1, startTime: "09:00", endTime: "18:00", availabilityType: "preferred", effectiveFrom: "2099-01-01", notes: c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "create_availability", employeeId: c.victim.worker.id, weekday: 1, startTime: "09:00", endTime: "18:00", availabilityType: "preferred", effectiveFrom: "2099-01-01", notes: c.marker }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "create_availability", employeeId: c.victim.worker.id, weekday: 1, startTime: "09:00", endTime: "18:00", availabilityType: "preferred", effectiveFrom: "2099-01-01", notes: c.marker }) },
      expect: (before, after, c, response) => {
        const row = added(before, after, c, response.json?.availability); assert.equal(row.employeeId, c.workerId); assert.equal(row.weekday, 1);
        assert.equal(row.startTime, "09:00"); assert.equal(row.endTime, "18:00"); assert.equal(row.availabilityType, "preferred"); assert.equal(row.effectiveFrom, "2099-01-01");
        assert.equal(row.notes, c.marker); assert.equal(row.createdByUserId, c.owner.id);
      } },
    { key: "POST workforce/schedule-swaps", status: 201,
      seed: async e => {
        const counterparty = await addWorker(e, "WFSWAP");
        const [shift] = await db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: e.marker + "-SWAP", name: e.marker + " swap", startTime: "09:00", endTime: "18:00", breakMinutes: 60 }).returning();
        const [pattern] = await db.insert(schedulePatterns).values({ organizationId: e.org.id, code: e.marker + "-SWAP", name: e.marker + " swap", cycleDays: 1 }).returning();
        const [day] = await db.insert(schedulePatternDays).values({ patternId: pattern.id, dayIndex: 0, isRestDay: false }).returning();
        await db.insert(schedulePatternSegments).values({ patternDayId: day.id, shiftDefinitionId: shift.id, segmentOrder: 1 });
        const assignments = [];
        for (const worker of [e.worker, counterparty]) assignments.push((await db.insert(employeeScheduleAssignments).values({ organizationId: e.org.id, employeeId: worker.id, patternId: pattern.id, effectiveFrom: "2026-01-05", anchorDate: "2026-01-05", reason: e.marker }).returning())[0]);
        return { id: counterparty.id, shiftId: shift.id, shiftCode: shift.code, patternId: pattern.id, requesterAssignmentId: assignments[0].id, counterpartyAssignmentId: assignments[1].id };
      },
      state: async orgId => ({ swaps: await state(scheduleSwapRequests, orgId), assignments: await state(employeeScheduleAssignments, orgId), overrides: await state(scheduleOverrides, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "create_request", requesterEmployeeId: c.workerId, counterpartyEmployeeId: c.seeded.id, requesterWorkDate: "2099-03-03", counterpartyWorkDate: "2099-03-04", reason: c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "create_request", requesterEmployeeId: c.victim.worker.id, counterpartyEmployeeId: c.victimSeeded.id, requesterWorkDate: "2099-03-03", counterpartyWorkDate: "2099-03-04", reason: c.marker }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "create_request", requesterEmployeeId: c.workerId, counterpartyEmployeeId: c.victimSeeded.id, requesterWorkDate: "2099-03-03", counterpartyWorkDate: "2099-03-04", reason: c.marker }) },
      expect: (before, after, c, response) => {
        const row = added(before.swaps, after.swaps, c, response.json?.swap); assert.deepEqual(after.assignments, before.assignments); assert.deepEqual(after.overrides, before.overrides);
        assert.equal(row.requesterEmployeeId, c.workerId); assert.equal(row.counterpartyEmployeeId, c.seeded.id); assert.equal(row.status, "pending"); assert.equal(row.reason, c.marker); assert.equal(row.requestedByUserId, c.owner.id);
        assert.equal(row.requesterWorkDate, "2099-03-03"); assert.equal(row.counterpartyWorkDate, "2099-03-04");
        for (const [snapshot, date, assignmentId] of [[row.requesterScheduleSnapshot, "2099-03-03", c.seeded.requesterAssignmentId], [row.counterpartyScheduleSnapshot, "2099-03-04", c.seeded.counterpartyAssignmentId]]) {
          assert.equal(snapshot.date, date); assert.equal(snapshot.source, "pattern"); assert.equal(snapshot.overrideId, null); assert.equal(snapshot.assignmentId, assignmentId); assert.equal(snapshot.patternId, c.seeded.patternId); assert.equal(snapshot.isRestDay, false);
          assert.equal(snapshot.segments.length, 1); const segment = snapshot.segments[0]; assert.equal(segment.shiftDefinitionId, c.seeded.shiftId); assert.equal(segment.shiftCode, c.seeded.shiftCode); assert.equal(segment.startTime, "09:00"); assert.equal(segment.endTime, "18:00"); assert.equal(segment.breakMinutes, 60);
        }
      } },
    { key: "POST workforce/schedule-guardrails",
      state: orgId => policyState(workforceScheduleGuardrailPolicies, orgId),
      ownBody: c => ({ organizationId: c.orgId, action: "update_policy", minimumRestMinutes: 600 + 10 * c.rank, maxConsecutiveWorkingDays: 5, rollingSevenDayMinutes: 2400, enforcementMode: "advisory", active: false }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "update_policy", minimumRestMinutes: 600 + 10 * c.rank, maxConsecutiveWorkingDays: 5, rollingSevenDayMinutes: 2400, enforcementMode: "advisory", active: false }),
      expect: (before, after, c, response) => {
        const { row, audit } = newPolicy(before, after, c, "WFM schedule guardrail policy updated");
        const policy = { minimumRestMinutes: 600 + 10 * c.rank, maxConsecutiveWorkingDays: 5, rollingSevenDayMinutes: 2400, enforcementMode: "advisory", active: false };
        for (const [key, value] of Object.entries(policy)) assert.equal(row[key], value);
        assert.equal(row.updatedBy, c.owner.name); assert.equal(response.json?.configured, true); assert.deepEqual(response.json.policy, policy);
        assert.deepEqual(audit.metadata, { policyId: row.id, ...policy });
      } },
    { key: "POST workforce/roster-rules", profile: "flagged-reads", flags: ["WFM_ROSTER_SCALE_RULES_ENABLED"],
      state: orgId => policyState(workforceRosterRulePolicies, orgId),
      ownBody: c => ({ organizationId: c.orgId, action: "update_policy", reason: c.marker + " fictional policy", active: false, maxDailyMinutes: 720 + 10 * c.rank, maxRollingSevenDayMinutes: 2880, minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480, approvedOvertimeCapMinutes: 0, enforcementMode: "advisory" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "update_policy", reason: c.marker + " fictional policy", active: false, maxDailyMinutes: 720 + 10 * c.rank, maxRollingSevenDayMinutes: 2880, minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480, approvedOvertimeCapMinutes: 0, enforcementMode: "advisory" }),
      expect: (before, after, c, response) => {
        const { row, audit } = newPolicy(before, after, c, "WFM roster policy updated");
        const policy = { active: false, maxDailyMinutes: 720 + 10 * c.rank, maxRollingSevenDayMinutes: 2880, minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480, approvedOvertimeCapMinutes: 0, enforcementMode: "advisory" };
        for (const [key, value] of Object.entries(policy)) assert.equal(row[key], value);
        assert.equal(row.updatedByUserId, c.owner.id); assert.equal(response.json?.configured, true); assert.deepEqual(response.json.policy, policy);
        assert.equal(audit.metadata.changedByUserId, c.owner.id); assert.equal(audit.metadata.reason, c.marker + " fictional policy"); assert.deepEqual(audit.metadata.after, policy);
      } },
  ];
}
