// Fictional fixtures only; no ratings finalized, credentials verified or reminders sent.
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, performanceGoals, performanceCycles, performanceReviews, performanceOneOnOnes,
  jobProfiles, hcmSkills, hcmJobProfileSkillRequirements, performanceCalibrationSessions, performanceCalibrationEntries,
  performanceCalibrationFlags, performanceCalibrationPolicies, performanceCalibrationPolicyEvents, performanceSkillDevelopmentPlans,
  performanceSkillDevelopmentMilestones, performanceSkillDevelopmentPlanEvents, performanceActionReminderPolicies, performanceActionReminderPolicyEvents }) {
  const state = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const created = (before, after, c, payload) => {
    assert.equal(after.length, before.length + 1);
    const added = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(added.length, 1);
    const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.equal(row.organizationId, c.orgId); assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    assert.deepEqual(after.filter(r => r.id !== row.id), before); return row;
  };
  const updated = (before, after, c, payload) => {
    assert.equal(after.length, before.length);
    const old = before.find(r => r.id === c.seeded.id), row = after.find(r => r.id === c.seeded.id);
    assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
    assert.notDeepEqual(old, row); assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    assert.deepEqual(after.filter(r => r.id !== row.id), before.filter(r => r.id !== row.id)); return row;
  };
  const companion = (before, after, c) => {
    assert.equal(after.length, before.length + 1);
    const added = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(added.length, 1);
    assert.deepEqual(after.filter(r => r.id !== added[0].id), before);
    assert.equal(added[0].organizationId, c.orgId); return added[0];
  };
  const requirement = async (e, suffix) => {
    const [profile] = await db.insert(jobProfiles).values({ organizationId: e.org.id, title: e.marker + suffix }).returning();
    const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + suffix, name: e.marker + suffix }).returning();
    return { id: profile.id, skillId: skill.id };
  };
  return [
    { key: "POST performance", status: 201,
      state: orgId => state(performanceGoals, orgId),
      ownBody: c => ({ organizationId: c.orgId, entityType: "goal", scope: "employee", employeeId: c.workerId, title: c.marker + " new goal", weight: 25, dueDate: "2099-12-31" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "goal", scope: "employee", employeeId: c.victim.worker.id, title: c.marker + " new goal", weight: 25, dueDate: "2099-12-31" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, entityType: "goal", scope: "employee", employeeId: c.victim.worker.id, title: c.marker + " new goal", weight: 25 }) },
      expect: (before, after, c, response) => {
        const row = created(before, after, c, response.json);
        assert.equal(row.employeeId, c.workerId); assert.equal(row.title, c.marker + " new goal"); assert.equal(row.scope, "employee");
        assert.equal(Number(row.weight), 25); assert.equal(row.progress, 0); assert.equal(row.status, "active"); assert.equal(row.dueDate, "2099-12-31"); assert.equal(row.createdByUserId, c.owner.id);
      } },
    { key: "PATCH performance",
      seed: async e => (await db.insert(performanceGoals).values({ organizationId: e.org.id, employeeId: e.worker.id, scope: "employee", title: e.marker + " existing goal", progress: 0 }).returning())[0],
      state: orgId => state(performanceGoals, orgId),
      ownBody: c => ({ entityType: "goal", id: c.seeded.id, progress: 40 }),
      foreignBody: c => ({ entityType: "goal", id: c.victimSeeded.id, progress: 40 }),
      expect: (before, after, c, response) => {
        const row = updated(before, after, c, response.json);
        assert.equal(row.employeeId, c.workerId); assert.equal(row.title, c.marker + " existing goal"); assert.equal(row.progress, 40); assert.equal(row.status, "active");
      } },
    { key: "POST performance/competencies", status: 201,
      seed: e => requirement(e, "-CGNEW"),
      state: orgId => state(hcmJobProfileSkillRequirements, orgId),
      ownBody: c => ({ organizationId: c.orgId, entityType: "requirement", jobProfileId: c.seeded.id, skillId: c.seeded.skillId, minimumProficiency: 3, mandatory: true }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "requirement", jobProfileId: c.victimSeeded.id, skillId: c.victimSeeded.skillId, minimumProficiency: 3 }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, entityType: "requirement", jobProfileId: c.seeded.id, skillId: c.victimSeeded.skillId, minimumProficiency: 3 }) },
      expect: (before, after, c, response) => {
        const row = created(before, after, c, response.json);
        assert.equal(row.jobProfileId, c.seeded.id); assert.equal(row.skillId, c.seeded.skillId); assert.equal(row.minimumProficiency, 3); assert.equal(row.mandatory, true); assert.equal(row.createdByUserId, c.owner.id);
      } },
    { key: "PATCH performance/competencies",
      seed: async e => { const refs = await requirement(e, "-CGEDIT"); return (await db.insert(hcmJobProfileSkillRequirements).values({ organizationId: e.org.id, jobProfileId: refs.id, skillId: refs.skillId, minimumProficiency: 1, mandatory: true }).returning())[0]; },
      state: orgId => state(hcmJobProfileSkillRequirements, orgId),
      ownBody: c => ({ organizationId: c.orgId, entityType: "requirement", id: c.seeded.id, minimumProficiency: 4, mandatory: false }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "requirement", id: c.victimSeeded.id, minimumProficiency: 4, mandatory: false }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, entityType: "requirement", id: c.victimSeeded.id, minimumProficiency: 4 }) },
      expect: (before, after, c, response) => {
        const row = updated(before, after, c, response.json);
        assert.equal(row.jobProfileId, c.seeded.jobProfileId); assert.equal(row.skillId, c.seeded.skillId); assert.equal(row.minimumProficiency, 4); assert.equal(row.mandatory, false);
      } },
    { key: "POST performance/continuous", status: 201,
      state: orgId => state(performanceOneOnOnes, orgId),
      ownBody: c => ({ organizationId: c.orgId, entityType: "one_on_one", employeeId: c.workerId, scheduledFor: "2099-03-01T09:00:00Z", agenda: c.marker + " new meeting" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "one_on_one", employeeId: c.victim.worker.id, scheduledFor: "2099-03-01T09:00:00Z", agenda: c.marker + " new meeting" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, entityType: "one_on_one", employeeId: c.victim.worker.id, scheduledFor: "2099-03-01T09:00:00Z", agenda: c.marker + " new meeting" }) },
      expect: (before, after, c, response) => {
        const row = created(before, after, c, response.json);
        assert.equal(row.employeeId, c.workerId); assert.equal(row.managerUserId, c.owner.id); assert.equal(row.createdByUserId, c.owner.id);
        assert.equal(row.agenda, c.marker + " new meeting"); assert.equal(row.status, "scheduled"); assert.equal(new Date(row.scheduledFor).toISOString(), "2099-03-01T09:00:00.000Z");
      } },
    { key: "POST performance/development-plans", status: 201,
      seed: async e => { const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-MILE", name: e.marker + " milestone" }).returning();
        return (await db.insert(performanceSkillDevelopmentPlans).values({ organizationId: e.org.id, employeeId: e.worker.id, skillId: skill.id, title: e.marker + " milestone plan", objective: e.marker, targetProficiency: "4.00", targetDate: "2099-12-31", createdByName: e.owner.name }).returning())[0]; },
      state: async orgId => ({ milestones: await state(performanceSkillDevelopmentMilestones, orgId), events: await state(performanceSkillDevelopmentPlanEvents, orgId), plans: await state(performanceSkillDevelopmentPlans, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, entityType: "milestone", planId: c.seeded.id, title: c.marker + " new milestone", detail: c.marker, dueDate: "2099-12-01" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, entityType: "milestone", planId: c.victimSeeded.id, title: c.marker + " new milestone", dueDate: "2099-12-01" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, entityType: "milestone", planId: c.victimSeeded.id, title: c.marker + " new milestone", dueDate: "2099-12-01" }) },
      expect: (before, after, c, response) => {
        const row = created(before.milestones, after.milestones, c, response.json);
        assert.equal(row.planId, c.seeded.id); assert.equal(row.title, c.marker + " new milestone"); assert.equal(row.detail, c.marker); assert.equal(row.dueDate, "2099-12-01"); assert.equal(row.status, "open");
        assert.deepEqual(after.plans, before.plans);
        const event = companion(before.events, after.events, c); assert.equal(event.planId, c.seeded.id); assert.equal(event.actorUserId, c.owner.id); assert.equal(event.eventType, "milestone_created"); assert.equal(event.afterSnapshot?.milestoneId, row.id);
      } },
    { key: "POST performance/calibration", status: 201,
      seed: async e => { const [cycle] = await db.insert(performanceCycles).values({ organizationId: e.org.id, name: e.marker + " calibration", startDate: "2026-01-01", endDate: "2026-12-31", status: "active" }).returning();
        const [review] = await db.insert(performanceReviews).values({ organizationId: e.org.id, employeeId: e.worker.id, cycleId: cycle.id, reviewerUserId: e.owner.id, status: "completed", managerScore: "3.00", finalScore: "3.00", managerSummary: e.marker, completedAt: new Date("2026-10-01T00:00:00Z") }).returning(); return { id: cycle.id, reviewId: review.id }; },
      state: async orgId => ({ sessions: await state(performanceCalibrationSessions, orgId), entries: await state(performanceCalibrationEntries, orgId), flags: await state(performanceCalibrationFlags, orgId), reviews: await state(performanceReviews, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, cycleId: c.seeded.id, name: c.marker + " calibration session", notes: c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, cycleId: c.victimSeeded.id, name: c.marker + " calibration session" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, cycleId: c.victimSeeded.id, name: c.marker + " calibration session" }) },
      expect: (before, after, c, response) => {
        const row = created(before.sessions, after.sessions, c, response.json);
        assert.equal(row.cycleId, c.seeded.id); assert.equal(row.name, c.marker + " calibration session"); assert.equal(row.notes, c.marker); assert.equal(row.status, "open"); assert.equal(row.createdByUserId, c.owner.id); assert.equal(row.finalizedAt, null);
        const entry = companion(before.entries, after.entries, c); assert.equal(entry.sessionId, row.id); assert.equal(entry.reviewId, c.seeded.reviewId); assert.equal(Number(entry.originalScore), 3); assert.equal(entry.calibratedScore, null);
        assert.deepEqual(after.reviews, before.reviews); for (const flag of after.flags) assert.equal(flag.organizationId, c.orgId);
      } },
    { key: "PATCH performance/calibration",
      state: async orgId => ({ policies: await state(performanceCalibrationPolicies, orgId), events: await state(performanceCalibrationPolicyEvents, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "policy", expectedVersion: 0, minimumManagerSample: 10 + c.rank, managerMeanDeviationThreshold: 1, highRatingThreshold: 4, highRatingShareThreshold: 80, lowRatingThreshold: 2, lowRatingShareThreshold: 50, largeScoreChangeThreshold: 1, requireFlagResolution: true }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "policy", expectedVersion: 0, minimumManagerSample: 10 + c.rank, managerMeanDeviationThreshold: 1, highRatingThreshold: 4, highRatingShareThreshold: 80, lowRatingThreshold: 2, lowRatingShareThreshold: 50, largeScoreChangeThreshold: 1, requireFlagResolution: true }),
      expect: (before, after, c, response) => {
        const row = companion(before.policies, after.policies, c); assert.equal(row.version, 1); assert.equal(row.updatedByUserId, c.owner.id); assert.equal(row.minimumManagerSample, 10 + c.rank);
        for (const [key, value] of Object.entries({ managerMeanDeviationThreshold: 1, highRatingThreshold: 4, highRatingShareThreshold: 80, lowRatingThreshold: 2, lowRatingShareThreshold: 50, largeScoreChangeThreshold: 1 })) assert.equal(Number(row[key]), value);
        assert.equal(row.requireFlagResolution, true);
        const snapshot = { version: 1, minimumManagerSample: row.minimumManagerSample, managerMeanDeviationThreshold: 1, highRatingThreshold: 4, highRatingShareThreshold: 80, lowRatingThreshold: 2, lowRatingShareThreshold: 50, largeScoreChangeThreshold: 1, requireFlagResolution: true };
        assert.deepEqual(response.json?.policy, snapshot);
        const event = companion(before.events, after.events, c); assert.equal(event.policyId, row.id); assert.equal(event.actorUserId, c.owner.id); assert.equal(event.fromVersion, null); assert.equal(event.toVersion, 1); assert.equal(event.beforeSnapshot, null); assert.deepEqual(event.afterSnapshot, snapshot);
      } },
    { key: "PATCH performance/follow-through-governance",
      state: async orgId => ({ policies: await state(performanceActionReminderPolicies, orgId), events: await state(performanceActionReminderPolicyEvents, orgId) }),
      ownBody: c => ({ organizationId: c.orgId, action: "action_reminder_policy", expectedVersion: 0, enabled: false, reminderDaysBefore: 5 + c.rank, escalationDaysOverdue: 10 + c.rank, notifyManagerOnEmployeeItem: false, notifyPeopleAdminOnEscalation: false }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "action_reminder_policy", expectedVersion: 0, enabled: false, reminderDaysBefore: 5 + c.rank, escalationDaysOverdue: 10 + c.rank, notifyManagerOnEmployeeItem: false, notifyPeopleAdminOnEscalation: false }),
      expect: (before, after, c, response) => {
        const row = companion(before.policies, after.policies, c); assert.equal(row.version, 1); assert.equal(row.updatedByUserId, c.owner.id); assert.equal(row.enabled, false);
        assert.equal(row.reminderDaysBefore, 5 + c.rank); assert.equal(row.escalationDaysOverdue, 10 + c.rank); assert.equal(row.notifyManagerOnEmployeeItem, false); assert.equal(row.notifyPeopleAdminOnEscalation, false);
        const snapshot = { version: 1, enabled: false, reminderDaysBefore: row.reminderDaysBefore, escalationDaysOverdue: row.escalationDaysOverdue, notifyManagerOnEmployeeItem: false, notifyPeopleAdminOnEscalation: false };
        assert.deepEqual(response.json?.reminderPolicy, snapshot);
        const event = companion(before.events, after.events, c); assert.equal(event.policyId, row.id); assert.equal(event.actorUserId, c.owner.id); assert.equal(event.fromVersion, null); assert.equal(event.toVersion, 1); assert.equal(event.beforeSnapshot, null); assert.deepEqual(event.afterSnapshot, snapshot);
      } },
  ];
}
