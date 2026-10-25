// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "POST discipline": 0
};

export function createRows({ asc, assert, db, disciplinaryCases, eq, provisioningTasks, dynamicWorkerGroups, jobRequisitions, jobApplicants }) {
  const updated = (before, after, c, response, payload = response.json) => {
    assert.equal(after.length, before.length);
    const old = before.find(r => r.id === c.seeded.id), row = after.find(r => r.id === c.seeded.id);
    assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
    assert.notDeepEqual(row, old); assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    return row;
  };
  const created = (before, after, c, response, payload = response.json) => {
    assert.equal(after.length, before.length + 1);
    const added = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(added.length, 1);
    const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.equal(row.organizationId, c.orgId); assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    return row;
  };
  return [
  { key: "POST discipline", status: 201,
    state: (orgId) => db.select().from(disciplinaryCases).where(eq(disciplinaryCases.organizationId, orgId)).orderBy(asc(disciplinaryCases.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, employeeId: c.victim.worker.id, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }) },
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one case is created");
      const row = after.find((r) => r.offense === c.marker);
      assert.ok(row, "the created case carries the own marker");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "nte_issued");
    } },
  { key: "PATCH discipline",
    seed: async (e) => (await db.insert(disciplinaryCases).values({ organizationId: e.org.id, employeeId: e.worker.id, caseNumber: e.marker, offense: e.marker, incidentDate: "2026-02-02", status: "nte_issued", nteDetails: e.marker }).returning())[0],
    state: (orgId) => db.select().from(disciplinaryCases).where(eq(disciplinaryCases.organizationId, orgId)).orderBy(asc(disciplinaryCases.id)),
    ownBody: (c) => ({ id: c.seeded.id, action: "submit_explanation", employeeExplanation: c.marker + " written explanation" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, action: "submit_explanation", employeeExplanation: c.marker + " written explanation" }),
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.employeeId, c.workerId); assert.equal(row.offense, c.marker);
      assert.equal(row.employeeExplanation, c.marker + " written explanation"); assert.equal(row.status, "explanation_submitted"); assert.ok(row.explanationSubmittedAt);
    } },
  { key: "PATCH provisioning",
    seed: async (e) => (await db.insert(provisioningTasks).values({ organizationId: e.org.id, employeeId: e.worker.id, kind: "onboarding", title: e.marker, owner: "IT", done: false }).returning())[0],
    state: (orgId) => db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, orgId)).orderBy(asc(provisioningTasks.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, employeeId: c.workerId, done: true }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, employeeId: c.victim.worker.id, done: true }),
    forged: { status: 404, body: (c) => ({ id: c.victimSeeded.id, organizationId: c.orgId, employeeId: c.workerId, done: true }) },
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.employeeId, c.workerId); assert.equal(row.title, c.marker);
      assert.equal(row.done, true); assert.equal(row.completedBy, c.owner.name); assert.ok(row.completedAt);
    } },
  { key: "POST dynamic-worker-groups",
    seed: async (e) => (await db.insert(dynamicWorkerGroups).values({ organizationId: e.org.id, code: e.marker.toLowerCase(), name: e.marker, conditions: { version: 1, all: [{ field: "title", operator: "eq", value: "Fictional" }], any: [] }, version: 1, active: false, createdByUserId: e.owner.id, createdByName: e.marker }).returning())[0],
    state: (orgId) => db.select().from(dynamicWorkerGroups).where(eq(dynamicWorkerGroups.organizationId, orgId)).orderBy(asc(dynamicWorkerGroups.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "save-group", id: c.seeded.id, name: c.marker + " revised", code: c.seeded.code, conditions: c.seeded.conditions }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "save-group", id: c.victimSeeded.id, name: c.marker + " revised", code: c.victimSeeded.code, conditions: c.victimSeeded.conditions }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "save-group", id: c.victimSeeded.id, name: c.marker + " revised", code: c.victimSeeded.code, conditions: c.victimSeeded.conditions }) },
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response, response.json?.group);
      assert.equal(row.name, c.marker + " revised"); assert.equal(row.version, c.seeded.version + 1);
      assert.equal(row.code, c.seeded.code); assert.deepEqual(row.conditions, c.seeded.conditions); assert.equal(row.active, false);
    } },
  { key: "POST recruitment", status: 201,
    seed: async (e) => (await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker, department: e.marker, status: "open" }).returning())[0],
    state: (orgId) => db.select().from(jobApplicants).where(eq(jobApplicants.organizationId, orgId)).orderBy(asc(jobApplicants.id)),
    ownBody: (c) => ({ organizationId: c.orgId, entityType: "applicant", requisitionId: c.seeded.id, fullName: c.marker + " applicant", email: c.marker.toLowerCase() + "@example.invalid", notes: c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, entityType: "applicant", requisitionId: c.victimSeeded.id, fullName: c.marker + " applicant", email: c.marker.toLowerCase() + "@example.invalid" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, entityType: "applicant", requisitionId: c.victimSeeded.id, fullName: c.marker + " applicant", email: c.marker.toLowerCase() + "@example.invalid" }) },
    expect: (before, after, c, response) => {
      const row = created(before, after, c, response);
      assert.equal(row.requisitionId, c.seeded.id); assert.equal(row.fullName, c.marker + " applicant");
      assert.equal(row.email, c.marker.toLowerCase() + "@example.invalid"); assert.equal(row.stage, "applied"); assert.equal(row.notes, c.marker);
    } },
  { key: "PATCH recruitment",
    seed: async (e) => { const [req] = await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker, department: e.marker, status: "open" }).returning(); return (await db.insert(jobApplicants).values({ organizationId: e.org.id, requisitionId: req.id, fullName: e.marker, email: e.marker.toLowerCase() + "@example.invalid", stage: "applied", notes: e.marker }).returning())[0]; },
    state: (orgId) => db.select().from(jobApplicants).where(eq(jobApplicants.organizationId, orgId)).orderBy(asc(jobApplicants.id)),
    ownBody: (c) => ({ applicantId: c.seeded.id, notes: c.marker + " revised notes" }),
    foreignBody: (c) => ({ applicantId: c.victimSeeded.id, notes: c.marker + " revised notes" }),
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.fullName, c.marker); assert.equal(row.requisitionId, c.seeded.requisitionId);
      assert.equal(row.notes, c.marker + " revised notes"); assert.equal(row.stage, "applied"); assert.equal(row.hiredEmployeeId, null);
    } },
  ];
}
