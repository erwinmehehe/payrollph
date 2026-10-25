// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST hcm/engagement-surveys": 5,
  "PATCH hcm/employment-terms": 6,
  "PATCH hcm/employment-term-decisions": 7,
  "PATCH hcm/effective-changes": 8,
  "PATCH hcm/lifecycle-policy": 11
};

export function createRows({ addWorker, asc, assert, db, engagementSurveys, eq, hcmEmploymentTermDecisions, hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, workerEffectiveChanges }) {
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
  ];
}
