// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST hcm/engagement-surveys": 5,
  "PATCH hcm/employment-terms": 6,
  "PATCH hcm/employment-term-decisions": 7,
  "PATCH hcm/effective-changes": 8,
  "PATCH hcm/lifecycle-policy": 11
};

export function createRows({ addWorker, asc, assert, auditBusinessSnapshot, db, engagementSurveys, eq, hcmEmploymentTermDecisions, hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, workerEffectiveChanges, hcmEmploymentDecisionEvents, hcmBusinessProcessDefinitions, hcmBusinessProcessInstances, hcmJobProfileSkillRequirements, hcmSkills, jobProfiles, automationOperationalCases, pool, orgUnits }) {
  const added = (before, after, c, payload) => {
    assert.equal(after.length, before.length + 1);
    const rows = after.filter(r => !before.some(old => old.id === r.id));
    assert.equal(rows.length, 1); const row = rows[0];
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.equal(row.organizationId, c.orgId); assert.equal(payload?.id, row.id);
    assert.equal(payload?.organizationId, c.orgId); return row;
  };
  return [
  { key: "POST hcm/engagement-surveys", status: 201, flags: ["ENGAGEMENT_SURVEY_ENABLED"],
    state: (orgId) => db.select().from(engagementSurveys).where(eq(engagementSurveys.organizationId, orgId)).orderBy(asc(engagementSurveys.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "create", question: "Fictional pulse question " + c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "create", question: "Fictional pulse question " + c.marker }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one survey is created");
      const row = after.find((r) => r.question === "Fictional pulse question " + c.marker);
      assert.ok(row, "the created survey carries the own marker");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "open");
    } },
  { key: "PATCH hcm/employment-terms",
    seed: async (e) => (await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "TRM")).id,
      employmentType: "regular", termKind: "regular", effectiveFrom: "2026-01-05", reason: e.marker, requestedBy: e.marker }).returning())[0],
    state: (orgId) => db.select().from(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.organizationId, orgId)).orderBy(asc(hcmEmploymentTerms.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    forged: { status: 404, body: (c) => ({ id: c.victimSeeded.id, organizationId: c.orgId, action: "cancel" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own term is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "PATCH hcm/employment-term-decisions",
    seed: async (e) => {
      const worker = await addWorker(e, "DEC");
      const [term] = await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: worker.id, employmentType: "probationary",
        termKind: "probationary", effectiveFrom: "2026-01-05", reason: e.marker + " term", requestedBy: e.marker }).returning();
      return (await db.insert(hcmEmploymentTermDecisions).values({ organizationId: e.org.id, employeeId: worker.id, employmentTermId: term.id,
        decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: e.marker, requestedBy: e.marker }).returning())[0];
    },
    state: (orgId) => db.select().from(hcmEmploymentTermDecisions).where(eq(hcmEmploymentTermDecisions.organizationId, orgId)).orderBy(asc(hcmEmploymentTermDecisions.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    forged: { status: 404, body: (c) => ({ id: c.victimSeeded.id, organizationId: c.orgId, action: "cancel" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own decision is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "PATCH hcm/effective-changes",
    deny: 404, // a victim row is reported as not found, never confirmed
    seed: async (e) => (await db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "EFF")).id,
      effectiveDate: "2026-06-01", reason: e.marker, requestedBy: e.marker }).returning())[0],
    state: (orgId) => db.select().from(workerEffectiveChanges).where(eq(workerEffectiveChanges.organizationId, orgId)).orderBy(asc(workerEffectiveChanges.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own change is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "PATCH hcm/lifecycle-policy",
    // A distinct action window per employer: the saved window must be exactly the own request's.
    state: async (orgId) => ({
      policies: await db.select().from(hcmLifecyclePolicies).where(eq(hcmLifecyclePolicies.organizationId, orgId)).orderBy(asc(hcmLifecyclePolicies.id)),
      events: await db.select().from(hcmLifecyclePolicyEvents).where(eq(hcmLifecyclePolicyEvents.organizationId, orgId)).orderBy(asc(hcmLifecyclePolicyEvents.id)),
    }),
    ownBody: (c) => ({ organizationId: c.orgId, expectedVersion: 0, actionWindowDays: 40 + c.rank, reminderDays: [14, 7, 1, 0], overdueEscalationDays: [1, 5],
      requireManagerReviewForProbation: false, requireDecisionRationaleNote: false, requireNonRenewalAttachment: false }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, expectedVersion: 0, actionWindowDays: 40 + c.rank, reminderDays: [14, 7, 1, 0], overdueEscalationDays: [1, 5],
      requireManagerReviewForProbation: false, requireDecisionRationaleNote: false, requireNonRenewalAttachment: false }),
    expect: (before, after, c) => {
      assert.equal(after.policies.length, 1, "the own employer gains exactly one policy row");
      assert.equal(after.policies[0].organizationId, c.orgId);
      assert.equal(after.policies[0].actionWindowDays, 40 + c.rank, "the saved window is the own request's");
      assert.equal(after.events.length, before.events.length + 1, "one audit-style policy event is recorded");
    } },
  { key: "POST hcm/employment-terms", status: 201,
    seed: (e) => addWorker(e, "NEWTRM"),
    state: (orgId) => db.select().from(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.organizationId, orgId)).orderBy(asc(hcmEmploymentTerms.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.seeded.id, employmentType: "Regular", termKind: "regular", effectiveFrom: "2026-07-05", reason: c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.victimSeeded.id, employmentType: "Regular", termKind: "regular", effectiveFrom: "2026-07-05", reason: c.marker }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, employeeId: c.victimSeeded.id, employmentType: "Regular", termKind: "regular", effectiveFrom: "2026-07-05", reason: c.marker }) },
    expect: (before, after, c, response) => {
      const row = added(before, after, c, response.json?.term);
      assert.equal(row.employeeId, c.seeded.id); assert.equal(row.reason, c.marker);
      assert.equal(row.termKind, "regular"); assert.equal(row.employmentType, "Regular"); assert.equal(row.effectiveFrom, "2026-07-05");
      assert.equal(row.status, "pending_approval"); assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.requestedBy, c.owner.name);
      assert.equal(row.approvedByUserId, null); assert.equal(row.activatedAt, null);
    } },
  { key: "POST hcm/employment-term-decisions", status: 201,
    seed: async (e) => (await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "NEWDEC")).id,
      employmentType: "Regular", termKind: "regular", effectiveFrom: "2026-01-05", status: "active", reason: e.marker, requestedBy: e.owner.name }).returning())[0],
    state: async (orgId) => ({ decisions: await db.select().from(hcmEmploymentTermDecisions).where(eq(hcmEmploymentTermDecisions.organizationId, orgId)).orderBy(asc(hcmEmploymentTermDecisions.id)),
      events: await db.select().from(hcmEmploymentDecisionEvents).where(eq(hcmEmploymentDecisionEvents.organizationId, orgId)).orderBy(asc(hcmEmploymentDecisionEvents.id)) }),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.seeded.employeeId, employmentTermId: c.seeded.id, decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.victimSeeded.employeeId, employmentTermId: c.victimSeeded.id, decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: c.marker }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, employeeId: c.seeded.employeeId, employmentTermId: c.victimSeeded.id, decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: c.marker }) },
    expect: (before, after, c, response) => {
      const row = added(before.decisions, after.decisions, c, response.json?.decision);
      assert.equal(row.employeeId, c.seeded.employeeId); assert.equal(row.employmentTermId, c.seeded.id); assert.equal(row.reason, c.marker);
      assert.equal(row.decisionKind, "continue_current"); assert.equal(row.effectiveDate, "2026-07-05"); assert.equal(row.status, "pending_approval");
      assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.separationHandoffStatus, "none");
      assert.equal(after.events.length, before.events.length + 1);
      const events = after.events.filter(r => !before.events.some(old => old.id === r.id)); assert.equal(events.length, 1);
      const event = events[0]; assert.equal(event.organizationId, c.orgId); assert.equal(event.decisionId, row.id);
      assert.equal(event.employeeId, row.employeeId); assert.equal(event.actorUserId, c.owner.id); assert.equal(event.eventType, "requested");
    } },
  { key: "POST hcm/effective-changes", status: 201,
    seed: async (e) => { const worker = await addWorker(e, "NEWEFF");
      const [unit] = await db.insert(orgUnits).values({ organizationId: e.org.id, legalEntityId: e.entity.id, type: "department", code: e.marker + "-MOVE", name: e.marker + " destination" }).returning(); return { ...worker, targetUnitId: unit.id }; },
    state: async (orgId) => ({ changes: await db.select().from(workerEffectiveChanges).where(eq(workerEffectiveChanges.organizationId, orgId)).orderBy(asc(workerEffectiveChanges.id)),
      processes: await db.select().from(hcmBusinessProcessInstances).where(eq(hcmBusinessProcessInstances.organizationId, orgId)).orderBy(asc(hcmBusinessProcessInstances.id)) }),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.seeded.id, effectiveDate: "2099-07-05", movementType: "job_change", targetOrgUnitId: c.seeded.targetUnitId, reason: c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.victimSeeded.id, effectiveDate: "2099-07-05", movementType: "job_change", targetOrgUnitId: c.victimSeeded.targetUnitId, reason: c.marker }),
    forged: { status: 400, body: (c) => ({ organizationId: c.orgId, employeeId: c.seeded.id, effectiveDate: "2099-07-05", movementType: "job_change", targetOrgUnitId: c.victimSeeded.targetUnitId, reason: c.marker }) },
    expect: (before, after, c, response) => {
      const row = added(before.changes, after.changes, c, response.json);
      assert.equal(row.employeeId, c.seeded.id); assert.equal(row.targetOrgUnitId, c.seeded.targetUnitId); assert.equal(row.reason, c.marker);
      assert.equal(row.status, "pending_approval"); assert.equal(row.effectiveDate, "2099-07-05"); assert.equal(row.requestedByUserId, c.owner.id);
      assert.deepEqual(row.toSnapshot.changes, { orgUnitId: c.seeded.targetUnitId });
      assert.equal(after.processes.length, before.processes.length + 1);
      const processes = after.processes.filter(r => !before.processes.some(old => old.id === r.id)); assert.equal(processes.length, 1);
      const process = processes[0]; assert.equal(process.organizationId, c.orgId); assert.equal(process.employeeId, c.seeded.id);
      assert.equal(process.sourceType, "worker_effective_change"); assert.equal(process.sourceKey, String(row.id));
      assert.equal(process.initiatedByUserId, c.owner.id); assert.equal(response.json.businessProcess?.id, process.id);
    } },
  { key: "POST hcm/capabilities",
    seed: async (e) => { const [profile] = await db.insert(jobProfiles).values({ organizationId: e.org.id, title: e.marker }).returning();
      const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-JOBSKILL", name: e.marker }).returning(); const { hcmDocumentRequirements } = await import("../../../../src/db/schema.ts"); const [doc] = await db.insert(hcmDocumentRequirements).values({ organizationId: e.org.id, code: e.marker + "-DOC", name: e.marker + " document", kind: "license", createdByName: "Fictional fixture" }).returning(); return { id: profile.id, skillId: skill.id, docId: doc.id }; },
    state: (orgId) => db.select().from(hcmJobProfileSkillRequirements).where(eq(hcmJobProfileSkillRequirements.organizationId, orgId)).orderBy(asc(hcmJobProfileSkillRequirements.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "set_job_skill", jobProfileId: c.seeded.id, skillId: c.seeded.skillId, minimumProficiency: 3, mandatory: true }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "set_job_skill", jobProfileId: c.victimSeeded.id, skillId: c.victimSeeded.skillId, minimumProficiency: 3, mandatory: true }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "set_job_skill", jobProfileId: c.seeded.id, skillId: c.victimSeeded.skillId, minimumProficiency: 3 }) }, exercise: async (c, helpers) => (await import("../helpers/hcm-capabilities-actions.mjs")).capabilitiesActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, helpers),
    expect: (before, after, c, response) => {
      const row = added(before, after, c, response.json?.requirement);
      assert.equal(row.jobProfileId, c.seeded.id); assert.equal(row.skillId, c.seeded.skillId);
      assert.equal(row.minimumProficiency, 3); assert.equal(row.mandatory, true); assert.equal(row.createdByUserId, c.owner.id);
    } },
  { key: "POST hcm/business-processes/definitions",
    seed: async (e) => (await db.insert(hcmBusinessProcessDefinitions).values({ organizationId: e.org.id, code: e.marker + "-disable", name: e.marker,
      processType: "hire", effectiveFrom: "2026-01-01", active: true }).returning())[0],
    state: (orgId) => db.select().from(hcmBusinessProcessDefinitions).where(eq(hcmBusinessProcessDefinitions.organizationId, orgId)).orderBy(asc(hcmBusinessProcessDefinitions.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "set-active", id: c.seeded.id, active: false }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "set-active", id: c.victimSeeded.id, active: false }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "set-active", id: c.victimSeeded.id, active: false }) },
    expect: (before, after, c, response) => {
      assert.equal(after.length, before.length); const old = before.find(r => r.id === c.seeded.id), row = after.find(r => r.id === c.seeded.id);
      assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
      assert.equal(old.active, true); assert.equal(row.active, false); assert.equal(row.name, c.marker); assert.equal(row.code, c.seeded.code);
      assert.equal(row.version, c.seeded.version); assert.equal(response.json?.id, row.id); assert.equal(response.json?.organizationId, c.orgId);
    } },
  { key: "PATCH hcm/work-items",
    seed: async (e) => (await db.insert(automationOperationalCases).values({ organizationId: e.org.id, employeeId: e.worker.id, caseType: "attendance_resolution", sourceType: "tenant_fixture", sourceId: e.worker.id,
      ownerTeam: "HR Operations", title: e.marker, detail: e.marker, status: "open" }).returning())[0],
    state: async (orgId) => ({ cases: await db.select().from(automationOperationalCases).where(eq(automationOperationalCases.organizationId, orgId)).orderBy(asc(automationOperationalCases.id)),
      events: (await pool.query('SELECT * FROM hcm_work_item_events WHERE organization_id=$1 ORDER BY id', [orgId])).rows }),
    ownBody: (c) => ({ organizationId: c.orgId, id: c.seeded.id, ownerTeam: "People Operations", ownerUserId: c.owner.id }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, id: c.victimSeeded.id, ownerTeam: "People Operations", ownerUserId: c.victim.owner.id }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, id: c.victimSeeded.id, ownerTeam: "People Operations", ownerUserId: c.owner.id }) },
    expect: (before, after, c, response) => {
      assert.equal(after.cases.length, before.cases.length); const old = before.cases.find(r => r.id === c.seeded.id), row = after.cases.find(r => r.id === c.seeded.id);
      assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
      assert.equal(old.ownerTeam, "HR Operations"); assert.equal(row.ownerTeam, "People Operations"); assert.equal(row.assignedOwnerUserId, c.owner.id);
      assert.equal(row.employeeId, c.workerId); assert.equal(row.title, c.marker); assert.equal(row.status, "open");
      assert.equal(response.json?.item?.id, row.id); assert.equal(response.json?.item?.organization_id, c.orgId);
      assert.equal(after.events.length, before.events.length + 1);
      const events = after.events.filter(r => !before.events.some(oldEvent => oldEvent.id === r.id)); assert.equal(events.length, 1);
      const event = events[0]; assert.equal(event.organization_id, c.orgId); assert.equal(event.case_id, row.id); assert.equal(event.actor_user_id, c.owner.id);
      assert.equal(event.event_type, "ownership_sla_updated"); assert.equal(event.previous_value.ownerTeam, old.ownerTeam);
      assert.equal(event.next_value.ownerTeam, row.ownerTeam); assert.equal(event.next_value.ownerUserId, c.owner.id);
    } },
  ];
}
