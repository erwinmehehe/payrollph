// Fictional requests/configuration only. Where a row exercises a decision branch, a second fictional
// manager files the request so the owner decides someone else's request; nothing is paid or published.
import { createHash, randomBytes } from "node:crypto";

export const fixtureOrder = {};

export function createRows(deps) {
  const { assert, db, eq, asc, addWorker, shiftDefinitions, timePunches, attendanceCorrectionRequests, overtimeRequests, employeeAvailabilityRules, scheduleSwapRequests, schedulePatterns, schedulePatternDays, schedulePatternSegments, employeeScheduleAssignments, scheduleOverrides, workforceScheduleGuardrailPolicies, workforceRosterRulePolicies, auditEvents, auditBusinessSnapshot, userOrganizations, users, worksites } = deps;
  // The shared write runner's dependency list is bound by reviewed receipts, so tables it does not pass are
  // read from the application schema here (only the real PG16 proof runs this; unit harnesses inject them).
  let schema;
  const table = async (name) => deps[name] ?? (schema ??= await import("../../../../src/db/schema.ts"))[name];
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
      },
      // An existing own shift and one-day pattern: the targets for create_pattern segments and assign_schedule.
      seed: async e => {
        const [shift] = await db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: (e.marker + "-SCH").slice(0, 32), name: e.marker + " schedule shift",
          startTime: "09:00", endTime: "18:00", breakMinutes: 60 }).returning();
        const [pattern] = await db.insert(schedulePatterns).values({ organizationId: e.org.id, code: (e.marker + "-SCH").slice(0, 32), name: e.marker + " schedule pattern", cycleDays: 1 }).returning();
        const [day] = await db.insert(schedulePatternDays).values({ patternId: pattern.id, dayIndex: 0, isRestDay: false }).returning();
        await db.insert(schedulePatternSegments).values({ patternDayId: day.id, shiftDefinitionId: shift.id, segmentOrder: 1 });
        return { shiftId: shift.id, patternId: pattern.id };
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce/schedules";
        const snap = async (orgId) => JSON.parse(JSON.stringify({ shifts: await state(shiftDefinitions, orgId), patterns: await state(schedulePatterns, orgId),
          assignments: await state(employeeScheduleAssignments, orgId), overrides: await state(scheduleOverrides, orgId), audit: auditBusinessSnapshot(await state(auditEvents, orgId)) }));
        const victimBefore = await snap(c.victim.org.id);
        const refused = async (body, status, label, own) => {
          const r = expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
          assert.ok(!r.text.includes(c.victim.marker), label + " must not leak victim data");
          assert.deepEqual(await snap(c.orgId), own, label + " must write nothing in the own employer");
          assert.deepEqual(await snap(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");
        };
        const oneAudit = (before, after, action) => {
          assert.equal(after.audit.length, before.audit.length + 1, "one audit receipt: " + action);
          assert.deepEqual(after.audit.slice(0, -1), before.audit);
          const a = after.audit.at(-1); assert.equal(a.organizationId, c.orgId); assert.equal(a.actor, c.owner.name); assert.equal(a.action, action);
        };
        const onlyGrew = (before, after, table) => {
          assert.equal(after[table].length, before[table].length + 1, "exactly one new " + table + " row");
          assert.deepEqual(after[table].slice(0, -1), before[table], "existing " + table + " rows are unchanged");
          for (const other of Object.keys(after)) if (other !== table && other !== "audit") assert.deepEqual(after[other], before[other], table + " changes no " + other);
          const row = after[table].at(-1); assert.equal(row.organizationId, c.orgId); return row;
        };

        // create_pattern: a one-day cycle built from the own shift; a victim shift as segment is refused.
        const patternCode = (c.marker + "-PAT").slice(0, 32);
        const patternBody = (organizationId, shiftDefinitionId) => ({ organizationId, action: "create_pattern", code: patternCode, name: c.marker + " pattern",
          cycleDays: 1, days: [{ isRestDay: false, segments: [{ shiftDefinitionId }] }] });
        let before = await snap(c.orgId);
        expectStatus(await request(url, { method: "POST", cookie, body: patternBody(c.orgId, c.seeded.shiftId) }), 201, "own pattern");
        let after = await snap(c.orgId);
        const pattern = onlyGrew(before, after, "patterns");
        assert.equal(pattern.name, c.marker + " pattern"); assert.equal(pattern.cycleDays, 1);
        oneAudit(before, after, "Workforce schedule pattern created");
        await refused(patternBody(c.orgId, c.victimSeeded.shiftId), 422, "forged victim shift in pattern", after);
        await refused(patternBody(c.victim.org.id, c.seeded.shiftId), 403, "victim employer pattern", after);

        // assign_schedule: the own worker gets the own seeded pattern; a victim pattern is not found.
        const assignBody = (organizationId, patternId) => ({ organizationId, action: "assign_schedule", employeeId: c.workerId, patternId,
          effectiveFrom: "2099-06-01", anchorDate: "2099-06-01", reason: c.marker + " assignment" });
        before = after;
        expectStatus(await request(url, { method: "POST", cookie, body: assignBody(c.orgId, c.seeded.patternId) }), 201, "own schedule assignment");
        after = await snap(c.orgId);
        const assignment = onlyGrew(before, after, "assignments");
        assert.equal(assignment.employeeId, c.workerId); assert.equal(assignment.patternId, c.seeded.patternId); assert.equal(assignment.effectiveFrom, "2099-06-01");
        oneAudit(before, after, "Employee workforce schedule assigned");
        await refused(assignBody(c.orgId, c.victimSeeded.patternId), 404, "forged victim pattern assignment", after);
        await refused(assignBody(c.victim.org.id, c.seeded.patternId), 403, "victim employer assignment", after);

        // create_override: a rest-day override for the own worker; a victim worker is not found.
        const overrideBody = (organizationId, employeeId) => ({ organizationId, action: "create_override", employeeId, workDate: "2099-05-01", kind: "rest_day", reason: c.marker + " rest day" });
        before = after;
        expectStatus(await request(url, { method: "POST", cookie, body: overrideBody(c.orgId, c.workerId) }), 201, "own rest-day override");
        after = await snap(c.orgId);
        const override = onlyGrew(before, after, "overrides");
        assert.equal(override.employeeId, c.workerId); assert.equal(override.workDate, "2099-05-01"); assert.equal(override.isRestDay, true);
        oneAudit(before, after, "Employee schedule override created");
        await refused(overrideBody(c.orgId, c.victim.worker.id), 404, "forged victim worker override", after);
        await refused(overrideBody(c.victim.org.id, c.workerId), 403, "victim employer override", after);
        return { actions: ["create_pattern", "assign_schedule", "create_override"], forgedReferences: 3, victimEmployerDenials: 3 };
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
      },
      // Pending requests filed by a second fictional manager: self-approval is refused, so the owner decides them.
      seed: async (e) => {
        const [manager] = await db.insert(users).values({ email: e.marker.toLowerCase() + "-ot-manager@example.invalid",
          name: e.marker + " OT manager", passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
        await db.insert(userOrganizations).values({ userId: manager.id, organizationId: e.org.id, role: "admin", active: true });
        const file = async (note) => (await db.insert(overtimeRequests).values({ organizationId: e.org.id, employeeId: e.worker.id,
          workDate: "2099-03-04", requestedMinutes: 30, reason: e.marker + " " + note, requestedBy: manager.name,
          requestedByUserId: manager.id }).returning())[0];
        const decide = await file("single decision"), bulkA = await file("bulk A"), bulkB = await file("bulk B");
        for (const row of [decide, bulkA, bulkB]) { assert.equal(row.organizationId, e.org.id); assert.equal(row.status, "pending"); }
        return { decideId: decide.id, bulkIds: [bulkA.id, bulkB.id] };
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce/overtime";
        const snap = async (orgId) => JSON.parse(JSON.stringify({ requests: await state(overtimeRequests, orgId),
          budgets: await state((await table("overtimeBudgetPolicies")), orgId), audit: auditBusinessSnapshot(await state(auditEvents, orgId)) }));
        const victimBefore = await snap(c.victim.org.id);
        const refused = async (body, status, label, own) => {
          const r = expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
          assert.ok(!r.text.includes(c.victim.marker), label + " must not leak victim data");
          assert.deepEqual(await snap(c.orgId), own, label + " must write nothing in the own employer");
          assert.deepEqual(await snap(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");
        };
        const newAudits = (before, after, n, action) => {
          assert.equal(after.audit.length, before.audit.length + n, n + " audit receipt(s): " + action);
          assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit);
          for (const a of after.audit.slice(before.audit.length)) { assert.equal(a.organizationId, c.orgId); assert.equal(a.actor, c.owner.name); assert.equal(a.action, action); }
          return after.audit.slice(before.audit.length);
        };

        // upsert_budget: an advisory budget for the own unit, distinct minutes per employer.
        const budgetBody = (organizationId, orgUnitId) => ({ organizationId, action: "upsert_budget", orgUnitId, monthStart: "2099-03-01",
          budgetMinutes: 600 + c.rank, enforcementMode: "advisory" });
        let before = await snap(c.orgId);
        const saved = expectStatus(await request(url, { method: "POST", cookie, body: budgetBody(c.orgId, c.unitId) }), 200, "own overtime budget");
        let after = await snap(c.orgId);
        assert.equal(after.budgets.length, before.budgets.length + 1, "exactly one budget is created");
        const budget = after.budgets.at(-1);
        assert.equal(budget.organizationId, c.orgId); assert.equal(budget.orgUnitId, c.unitId);
        assert.equal(budget.budgetMinutes, 600 + c.rank); assert.equal(budget.enforcementMode, "advisory");
        assert.equal(budget.updatedByUserId, c.owner.id); assert.equal(saved.json?.budget?.id, budget.id);
        assert.deepEqual(after.requests, before.requests, "configuring a budget decides no request");
        assert.equal(newAudits(before, after, 1, "Overtime budget configured")[0].metadata.overtimeBudgetPolicyId, budget.id);
        await refused(budgetBody(c.orgId, c.victim.unit.id), 404, "forged victim unit budget", after);
        await refused(budgetBody(c.victim.org.id, c.unitId), 403, "victim employer budget", after);

        // decide_request approved: the owner approves the second manager's request.
        before = after;
        const decideBody = (organizationId, requestId) => ({ organizationId, action: "decide_request", requestId, decision: "approved", decisionNote: c.marker + " approved" });
        expectStatus(await request(url, { method: "POST", cookie, body: decideBody(c.orgId, c.seeded.decideId) }), 200, "own overtime approval");
        after = await snap(c.orgId);
        const approved = after.requests.find((r) => r.id === c.seeded.decideId);
        assert.equal(approved.status, "approved"); assert.equal(approved.decidedByUserId, c.owner.id);
        assert.deepEqual(after.requests.filter((r) => r.id !== approved.id), before.requests.filter((r) => r.id !== approved.id), "only the decided request changes");
        newAudits(before, after, 1, "Overtime request approved");
        await refused(decideBody(c.orgId, c.victimSeeded.decideId), 404, "forged victim overtime approval", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.decideId), 403, "victim employer overtime approval", after);

        // bulk_decide_requests rejected: both remaining requests in one call.
        before = after;
        const bulkBody = (organizationId, requestIds) => ({ organizationId, action: "bulk_decide_requests", requestIds, decision: "rejected", decisionNote: c.marker + " rejected" });
        expectStatus(await request(url, { method: "POST", cookie, body: bulkBody(c.orgId, c.seeded.bulkIds) }), 200, "own bulk overtime rejection");
        after = await snap(c.orgId);
        for (const id of c.seeded.bulkIds) {
          const row = after.requests.find((r) => r.id === id);
          assert.equal(row.status, "rejected"); assert.equal(row.decidedByUserId, c.owner.id);
        }
        newAudits(before, after, 2, "Overtime request rejected");
        await refused(bulkBody(c.orgId, c.victimSeeded.bulkIds), 404, "forged victim bulk decision", after);
        await refused(bulkBody(c.victim.org.id, c.victimSeeded.bulkIds), 403, "victim employer bulk decision", after);
        return { actions: ["upsert_budget", "decide_request:approved", "bulk_decide_requests:rejected"], forgedReferences: 3, victimEmployerDenials: 3 };
      } },
    { key: "POST workforce/attendance-corrections", status: 201,
      seed: async e => {
        const punch = async (workDate) => (await db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id, workDate,
          timeIn: new Date(workDate + "T09:00:00Z"), timeOut: new Date(workDate + "T18:00:00Z"), status: "Complete", notes: e.marker }).returning())[0];
        const created = await punch("2026-03-03");
        // Decision targets: corrections filed by a second fictional manager (self-approval is refused).
        const [manager] = await db.insert(users).values({ email: e.marker.toLowerCase() + "-ac-manager@example.invalid",
          name: e.marker + " attendance manager", passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
        await db.insert(userOrganizations).values({ userId: manager.id, organizationId: e.org.id, role: "admin", active: true });
        const correction = async (p, note) => {
          const original = { workDate: p.workDate, timeIn: p.workDate + "T09:00:00.000Z", timeOut: p.workDate + "T18:00:00.000Z", breakStart: null, breakEnd: null, status: "Complete" };
          return (await db.insert(attendanceCorrectionRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, punchId: p.id, workDate: p.workDate,
            originalPunchSnapshot: original, proposedPunchSnapshot: { ...original, timeIn: p.workDate + "T08:30:00.000Z" },
            reason: e.marker + " " + note, requestedBy: manager.name, requestedByUserId: manager.id }).returning())[0];
        };
        const approvePunch = await punch("2026-03-05"), rejectPunch = await punch("2026-03-06");
        const approve = await correction(approvePunch, "approve"), reject = await correction(rejectPunch, "reject");
        return { ...created, approvePunchId: approvePunch.id, approveId: approve.id, rejectPunchId: rejectPunch.id, rejectId: reject.id };
      },
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
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce/attendance-corrections";
        const snap = async (orgId) => JSON.parse(JSON.stringify({ corrections: await state(attendanceCorrectionRequests, orgId),
          punches: await state(timePunches, orgId), audit: auditBusinessSnapshot(await state(auditEvents, orgId)) }));
        const victimBefore = await snap(c.victim.org.id);
        const decideBody = (organizationId, requestId, decision) => ({ organizationId, action: "decide_request", requestId, decision, decisionNote: c.marker + " " + decision });
        const refused = async (body, status, label, own) => {
          const r = expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
          assert.ok(!r.text.includes(c.victim.marker), label + " must not leak victim data");
          assert.deepEqual(await snap(c.orgId), own, label + " must write nothing in the own employer");
          assert.deepEqual(await snap(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");
        };
        const oneAudit = (before, after, action) => {
          assert.equal(after.audit.length, before.audit.length + 1, "one audit receipt: " + action);
          assert.deepEqual(after.audit.slice(0, -1), before.audit);
          const a = after.audit.at(-1); assert.equal(a.organizationId, c.orgId); assert.equal(a.actor, c.owner.name); assert.equal(a.action, action);
        };

        // decide approved: the owner approves the second manager's correction and it is applied to the own punch.
        let before = await snap(c.orgId);
        expectStatus(await request(url, { method: "POST", cookie, body: decideBody(c.orgId, c.seeded.approveId, "approved") }), 200, "own correction approval");
        let after = await snap(c.orgId);
        const approved = after.corrections.find((r) => r.id === c.seeded.approveId);
        assert.equal(approved.status, "approved"); assert.equal(approved.decidedByUserId, c.owner.id); assert.ok(approved.appliedAt, "the approved correction is applied");
        const applied = after.punches.find((p) => p.id === c.seeded.approvePunchId);
        assert.equal(applied.organizationId, c.orgId); assert.equal(applied.timeIn, "2026-03-05T08:30:00.000Z", "the punch takes the proposed time");
        assert.deepEqual(after.punches.filter((p) => p.id !== applied.id), before.punches.filter((p) => p.id !== applied.id), "only the corrected punch changes");
        oneAudit(before, after, "Attendance correction approved and applied");
        await refused(decideBody(c.orgId, c.victimSeeded.approveId, "approved"), 404, "forged victim correction approval", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.approveId, "approved"), 403, "victim employer correction approval", after);

        // decide rejected: the correction is closed and the punch keeps its original time.
        before = after;
        expectStatus(await request(url, { method: "POST", cookie, body: decideBody(c.orgId, c.seeded.rejectId, "rejected") }), 200, "own correction rejection");
        after = await snap(c.orgId);
        const rejected = after.corrections.find((r) => r.id === c.seeded.rejectId);
        assert.equal(rejected.status, "rejected"); assert.equal(rejected.decidedByUserId, c.owner.id); assert.equal(rejected.appliedAt, null);
        assert.deepEqual(after.punches, before.punches, "a rejection changes no punch");
        oneAudit(before, after, "Attendance correction rejected");
        await refused(decideBody(c.orgId, c.victimSeeded.rejectId, "rejected"), 404, "forged victim correction rejection", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.rejectId, "rejected"), 403, "victim employer correction rejection", after);
        return { actions: ["decide_request:approved", "decide_request:rejected"], forgedReferences: 2, victimEmployerDenials: 2 };
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
      },
      // Own worksite/shift plus a fresh worker for claims; one requirement, open shift and pending claim are the
      // forged-reference targets another employer's owner tries to use.
      seed: async e => {
        const [site] = await db.insert(worksites).values({ organizationId: e.org.id, code: (e.marker + "-COV").slice(0, 32), name: e.marker + " coverage site" }).returning();
        const [shift] = await db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: (e.marker + "-COV").slice(0, 32), name: e.marker + " coverage shift",
          startTime: "09:00", endTime: "18:00", breakMinutes: 60 }).returning();
        const claimant = await addWorker(e, "COV");
        const [requirement] = await db.insert((await table("staffingRequirements"))).values({ organizationId: e.org.id, worksiteId: site.id, workDate: "2099-08-01",
          shiftDefinitionId: shift.id, requiredHeadcount: 1, createdBy: e.marker + " fixture" }).returning();
        const [openShift] = await db.insert((await table("openShifts"))).values({ organizationId: e.org.id, worksiteId: site.id, workDate: "2099-08-02", shiftDefinitionId: shift.id,
          slots: 1, status: "open", reason: e.marker + " target", createdBy: e.marker + " fixture" }).returning();
        const [claim] = await db.insert((await table("openShiftClaims"))).values({ organizationId: e.org.id, openShiftId: openShift.id, employeeId: claimant.id, status: "pending",
          reason: e.marker + " target claim", requestedBy: e.marker + " fixture" }).returning();
        return { siteId: site.id, shiftId: shift.id, claimantId: claimant.id, requirementId: requirement.id, openShiftId: openShift.id, claimId: claim.id };
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce/coverage";
        const snap = async (orgId) => JSON.parse(JSON.stringify({ requirements: await state((await table("staffingRequirements")), orgId), openShifts: await state((await table("openShifts")), orgId),
          claims: await state((await table("openShiftClaims")), orgId), overrides: await state(scheduleOverrides, orgId), audit: auditBusinessSnapshot(await state(auditEvents, orgId)) }));
        const victimBefore = await snap(c.victim.org.id);
        const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
        const refused = async (body, status, label, own) => {
          const r = await post(body, status, label);
          assert.ok(!r.text.includes(c.victim.marker), label + " must not leak victim data");
          assert.deepEqual(await snap(c.orgId), own, label + " must write nothing in the own employer");
          assert.deepEqual(await snap(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");
        };
        const audits = (before, after, action) => {
          assert.equal(after.audit.length, before.audit.length + 1, "one audit receipt: " + action);
          assert.deepEqual(after.audit.slice(0, -1), before.audit);
          const a = after.audit.at(-1); assert.equal(a.organizationId, c.orgId); assert.equal(a.actor, c.owner.name); assert.equal(a.action, action); return a;
        };
        const grew = (before, after, table) => {
          assert.equal(after[table].length, before[table].length + 1, "exactly one new " + table + " row");
          assert.deepEqual(after[table].slice(0, -1), before[table]);
          const row = after[table].at(-1); assert.equal(row.organizationId, c.orgId); return row;
        };

        // create_requirement: own site and shift; a victim worksite is refused.
        const reqBody = (organizationId, worksiteId) => ({ organizationId, action: "create_requirement", worksiteId, shiftDefinitionId: c.seeded.shiftId,
          workDate: "2099-07-01", requiredHeadcount: 2 + c.rank, notes: c.marker + " requirement" });
        let before = await snap(c.orgId);
        await post(reqBody(c.orgId, c.seeded.siteId), 201, "own staffing requirement");
        let after = await snap(c.orgId);
        const requirement = grew(before, after, "requirements");
        assert.equal(requirement.worksiteId, c.seeded.siteId); assert.equal(requirement.requiredHeadcount, 2 + c.rank); assert.equal(requirement.createdByUserId, c.owner.id);
        assert.deepEqual(after.openShifts, before.openShifts); assert.deepEqual(after.claims, before.claims);
        audits(before, after, "WFM staffing requirement created");
        await refused(reqBody(c.orgId, c.victimSeeded.siteId), 422, "forged victim worksite requirement", after);
        await refused(reqBody(c.victim.org.id, c.seeded.siteId), 403, "victim employer requirement", after);

        // stage_recovery_plan: stage the fresh worker against that requirement; a victim requirement is refused.
        const planBody = (organizationId, requirementId) => ({ organizationId, action: "stage_recovery_plan", assignments: [{ requirementId, employeeId: c.seeded.claimantId }] });
        before = after;
        await post(planBody(c.orgId, requirement.id), 201, "own recovery plan");
        after = await snap(c.orgId);
        const recoveryShift = grew(before, after, "openShifts");
        assert.equal(recoveryShift.sourceRequirementId, requirement.id);
        const recoveryClaim = grew(before, after, "claims");
        assert.equal(recoveryClaim.employeeId, c.seeded.claimantId); assert.equal(recoveryClaim.openShiftId, recoveryShift.id); assert.equal(recoveryClaim.status, "pending");
        assert.deepEqual(after.requirements, before.requirements);
        audits(before, after, "WFM recovery plan staged");
        await refused(planBody(c.orgId, c.victimSeeded.requirementId), 409, "forged victim requirement in recovery plan", after);
        await refused(planBody(c.victim.org.id, requirement.id), 403, "victim employer recovery plan", after);

        // create_open_shift: a separate own open shift; a victim worksite is not found.
        const shiftBody = (organizationId, worksiteId) => ({ organizationId, action: "create_open_shift", worksiteId, shiftDefinitionId: c.seeded.shiftId,
          workDate: "2099-07-02", slots: 1, reason: c.marker + " open shift" });
        before = after;
        await post(shiftBody(c.orgId, c.seeded.siteId), 201, "own open shift");
        after = await snap(c.orgId);
        const openShift = grew(before, after, "openShifts");
        assert.equal(openShift.status, "open"); assert.equal(openShift.sourceRequirementId, null); assert.equal(openShift.createdByUserId, c.owner.id);
        audits(before, after, "WFM open shift created");
        await refused(shiftBody(c.orgId, c.victimSeeded.siteId), 404, "forged victim worksite open shift", after);
        await refused(shiftBody(c.victim.org.id, c.seeded.siteId), 403, "victim employer open shift", after);

        // claim_open_shift: the owner claims it for the fresh worker; the victim's open shift is not found.
        const claimBody = (organizationId, openShiftId) => ({ organizationId, action: "claim_open_shift", openShiftId, employeeId: c.seeded.claimantId, reason: c.marker + " claim" });
        before = after;
        await post(claimBody(c.orgId, openShift.id), 201, "own open-shift claim");
        after = await snap(c.orgId);
        const claim = grew(before, after, "claims");
        assert.equal(claim.openShiftId, openShift.id); assert.equal(claim.employeeId, c.seeded.claimantId); assert.equal(claim.status, "pending"); assert.equal(claim.requestedByUserId, c.owner.id);
        audits(before, after, "WFM open shift claimed");
        await refused(claimBody(c.orgId, c.victimSeeded.openShiftId), 404, "forged victim open-shift claim", after);
        await refused(claimBody(c.victim.org.id, openShift.id), 403, "victim employer open-shift claim", after);

        // decide_claim approved: the claim is approved and exactly one schedule override is written.
        const decideBody = (organizationId, claimId, decision) => ({ organizationId, action: "decide_claim", claimId, decision, decisionNote: c.marker + " " + decision });
        before = after;
        await post(decideBody(c.orgId, claim.id, "approved"), 200, "own claim approval");
        after = await snap(c.orgId);
        const approved = after.claims.find((r) => r.id === claim.id);
        assert.equal(approved.status, "approved"); assert.equal(approved.decidedByUserId, c.owner.id);
        const override = grew(before, after, "overrides");
        assert.equal(override.employeeId, c.seeded.claimantId); assert.equal(override.workDate, "2099-07-02"); assert.equal(override.worksiteId, c.seeded.siteId);
        // decide_claim rejected: the staged recovery claim closes without any override.
        const afterApproval = after;
        await post(decideBody(c.orgId, recoveryClaim.id, "rejected"), 200, "own claim rejection");
        after = await snap(c.orgId);
        assert.equal(after.claims.find((r) => r.id === recoveryClaim.id).status, "rejected");
        assert.deepEqual(after.overrides, afterApproval.overrides, "a rejection writes no override");
        audits(afterApproval, after, "WFM open shift claim rejected");
        await refused(decideBody(c.orgId, c.victimSeeded.claimId, "rejected"), 404, "forged victim claim decision", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.claimId, "rejected"), 403, "victim employer claim decision", after);
        return { actions: ["create_requirement", "stage_recovery_plan", "create_open_shift", "claim_open_shift", "decide_claim:approved", "decide_claim:rejected"],
          forgedReferences: 5, victimEmployerDenials: 5 };
      } },
    { key: "POST workforce/schedule-swaps", status: 201,
      seed: async e => {
        const counterparty = await addWorker(e, "WFSWAP");
        const [shift] = await db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: e.marker + "-SWAP", name: e.marker + " swap", startTime: "09:00", endTime: "18:00", breakMinutes: 60 }).returning();
        const [pattern] = await db.insert(schedulePatterns).values({ organizationId: e.org.id, code: e.marker + "-SWAP", name: e.marker + " swap", cycleDays: 1 }).returning();
        const [day] = await db.insert(schedulePatternDays).values({ patternId: pattern.id, dayIndex: 0, isRestDay: false }).returning();
        await db.insert(schedulePatternSegments).values({ patternDayId: day.id, shiftDefinitionId: shift.id, segmentOrder: 1 });
        // Approval writes overrides at the assignment's worksite, so both assignments name one active fictional site.
        const [site] = await db.insert(worksites).values({ organizationId: e.org.id, code: (e.marker + "-SW").slice(0, 32), name: e.marker + " swap site" }).returning();
        const assignments = [];
        for (const worker of [e.worker, counterparty]) assignments.push((await db.insert(employeeScheduleAssignments).values({ organizationId: e.org.id, employeeId: worker.id, patternId: pattern.id, effectiveFrom: "2026-01-05", anchorDate: "2026-01-05", worksiteId: site.id, reason: e.marker }).returning())[0]);
        // A second fictional manager files swaps over real HTTP (self-approval is refused), and one pending swap
        // seeded directly is the forged-reference target another employer's owner tries to decide.
        const [manager] = await db.insert(users).values({ email: e.marker.toLowerCase() + "-swap-manager@example.invalid",
          name: e.marker + " swap manager", passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
        await db.insert(userOrganizations).values({ userId: manager.id, organizationId: e.org.id, role: "admin", active: true });
        const raw = randomBytes(32).toString("hex");
        await db.insert((await table("sessions"))).values({ userId: manager.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
          expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date() });
        const [pending] = await db.insert(scheduleSwapRequests).values({ organizationId: e.org.id, requesterEmployeeId: e.worker.id,
          counterpartyEmployeeId: counterparty.id, requesterWorkDate: "2099-04-01", counterpartyWorkDate: "2099-04-02",
          requesterScheduleSnapshot: {}, counterpartyScheduleSnapshot: {}, reason: e.marker + " pending target",
          requestedBy: manager.name, requestedByUserId: manager.id }).returning();
        return { id: counterparty.id, shiftId: shift.id, shiftCode: shift.code, patternId: pattern.id, requesterAssignmentId: assignments[0].id, counterpartyAssignmentId: assignments[1].id,
          managerCookie: "__Host-linaw_session=" + raw, managerId: manager.id, pendingSwapId: pending.id };
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
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce/schedule-swaps";
        const snap = async (orgId) => JSON.parse(JSON.stringify({ swaps: await state(scheduleSwapRequests, orgId), assignments: await state(employeeScheduleAssignments, orgId),
          overrides: await state(scheduleOverrides, orgId), audit: auditBusinessSnapshot(await state(auditEvents, orgId)) }));
        const victimBefore = await snap(c.victim.org.id);
        const createBody = (requesterWorkDate, counterpartyWorkDate) => ({ organizationId: c.orgId, action: "create_request", requesterEmployeeId: c.workerId,
          counterpartyEmployeeId: c.seeded.id, requesterWorkDate, counterpartyWorkDate, reason: c.marker + " manager swap" });
        const decideBody = (organizationId, requestId, decision) => ({ organizationId, action: "decide_request", requestId, decision, decisionNote: c.marker + " " + decision });
        const managerFiles = async (a, b) => {
          const r = expectStatus(await request(url, { method: "POST", cookie: c.seeded.managerCookie, body: createBody(a, b) }), 201, "second manager files a swap");
          assert.equal(r.json?.swap?.requestedByUserId, c.seeded.managerId); return r.json.swap.id;
        };
        const refused = async (body, status, label, own) => {
          const r = expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
          assert.ok(!r.text.includes(c.victim.marker), label + " must not leak victim data");
          assert.deepEqual(await snap(c.orgId), own, label + " must write nothing in the own employer");
          assert.deepEqual(await snap(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");
        };
        const oneAudit = (before, after, action) => {
          assert.equal(after.audit.length, before.audit.length + 1, "one audit receipt: " + action);
          assert.deepEqual(after.audit.slice(0, -1), before.audit);
          const a = after.audit.at(-1); assert.equal(a.organizationId, c.orgId); assert.equal(a.actor, c.owner.name); assert.equal(a.action, action);
        };

        // decide approved: the owner approves the manager's swap; both workers get one schedule override each.
        const approveId = await managerFiles("2099-03-10", "2099-03-11");
        let before = await snap(c.orgId);
        expectStatus(await request(url, { method: "POST", cookie, body: decideBody(c.orgId, approveId, "approved") }), 200, "own swap approval");
        let after = await snap(c.orgId);
        const approved = after.swaps.find((s) => s.id === approveId);
        assert.equal(approved.status, "approved"); assert.equal(approved.decidedByUserId, c.owner.id);
        assert.deepEqual(after.assignments, before.assignments, "approval adds overrides, never edits assignments");
        assert.equal(after.overrides.length, before.overrides.length + 2, "one override per swapped worker");
        const added2 = after.overrides.slice(before.overrides.length);
        assert.deepEqual(added2.map((o) => o.employeeId).sort((x, y) => x - y), [c.workerId, c.seeded.id].sort((x, y) => x - y));
        for (const o of added2) assert.equal(o.organizationId, c.orgId);
        oneAudit(before, after, "Workforce schedule swap approved");
        await refused(decideBody(c.orgId, c.victimSeeded.pendingSwapId, "approved"), 404, "forged victim swap approval", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.pendingSwapId, "approved"), 403, "victim employer swap approval", after);

        // decide rejected: the swap closes and no override is written.
        const rejectId = await managerFiles("2099-03-12", "2099-03-13");
        before = await snap(c.orgId);
        expectStatus(await request(url, { method: "POST", cookie, body: decideBody(c.orgId, rejectId, "rejected") }), 200, "own swap rejection");
        after = await snap(c.orgId);
        const rejected = after.swaps.find((s) => s.id === rejectId);
        assert.equal(rejected.status, "rejected"); assert.equal(rejected.decidedByUserId, c.owner.id);
        assert.deepEqual(after.overrides, before.overrides, "a rejection writes no override");
        oneAudit(before, after, "Workforce schedule swap rejected");
        await refused(decideBody(c.orgId, c.victimSeeded.pendingSwapId, "rejected"), 404, "forged victim swap rejection", after);
        await refused(decideBody(c.victim.org.id, c.victimSeeded.pendingSwapId, "rejected"), 403, "victim employer swap rejection", after);
        return { actions: ["decide_request:approved", "decide_request:rejected"], forgedReferences: 2, victimEmployerDenials: 2 };
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
