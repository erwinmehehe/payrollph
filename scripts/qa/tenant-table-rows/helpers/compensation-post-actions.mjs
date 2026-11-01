/**
 * POST compensation: the entity types the single-type table row does not prove (cycle, band, component_assignment, proposal).
 * The row proves `component`. These run as a real chain on fictional employers: a cycle, then a band for the seeded job
 * profile, then a recurring component assignment and a proposal that reference them. Every refusal (forged victim reference,
 * victim employer, retroactive date, overlap, duplicate) must leave the own employer and the victim byte-identical.
 * Nothing here approves, schedules or applies pay. Lives outside write/ so the family loader does not treat it as a row file.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

/** Called from the row's seed: a grade, a graded job profile, a component and a primary position for the seeded worker. */
export async function seedCompensation({ db, jobProfiles }, e) {
  const t = await tables();
  const [grade] = await db.insert(t.jobGrades).values({ organizationId: e.org.id, code: ("G" + e.marker).slice(-38).toUpperCase(), name: e.marker + " compensation seed grade" }).returning();
  const [profile] = await db.insert(jobProfiles).values({ organizationId: e.org.id, title: e.marker + " compensation profile", gradeId: grade.id }).returning();
  const [component] = await db.insert(t.compensationComponents).values({ organizationId: e.org.id, code: ("SEED" + e.marker).slice(-38).toUpperCase(),
    name: e.marker + " seeded component", kind: "allowance", amountFrequency: "monthly" }).returning();
  const [position] = await db.insert(t.positions).values({ organizationId: e.org.id, code: ("CP-" + e.marker).slice(-46), jobProfileId: profile.id,
    orgUnitId: e.unit.id, legalEntityId: e.entity.id, employmentType: "Regular", status: "filled", annualBudget: "0" }).returning();
  await db.insert(t.positionAssignments).values({ organizationId: e.org.id, positionId: position.id, employeeId: e.worker.id,
    assignmentType: "primary", fte: "1.0000", effectiveFrom: "2026-01-05", reason: "fixture" });
  return { gradeId: grade.id, profileId: profile.id, componentId: component.id, entityId: e.entity.id };
}

export async function compensationPostActions({ assert, state }, c, { request, expectStatus, cookie }) {
  const url = "/api/compensation";
  const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
  const victimBefore = await state(c.victim.org.id);
  const refused = async (body, status, label) => {
    const own = await state(c.orgId);
    const response = await post(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await state(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await state(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };
  const newRows = (before, after, key) => after[key].filter((row) => !before[key].some((old) => old.id === row.id));
  const only = (before, after, ...changed) => {
    for (const key of Object.keys(before).filter((name) => !changed.includes(name) && name !== "audits")) assert.deepEqual(after[key], before[key], key + " must not change");
  };
  const receipt = (before, after, action) => {
    const added = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id));
    assert.deepEqual(after.audits.filter((row) => before.audits.some((old) => old.id === row.id)), before.audits, "earlier audit rows are unchanged");
    for (const row of added) { assert.equal(row.organizationId, c.orgId); assert.equal(row.actor, c.owner.name); }
    assert.equal(added.filter((row) => row.action === action).length, 1, "exactly one audit receipt: " + action);
    return added.find((row) => row.action === action);
  };
  const seed = c.seeded, vseed = c.victimSeeded;

  // cycle
  const cycleBody = (organizationId) => ({ organizationId, entityType: "cycle", name: c.marker + " compensation cycle", startDate: "2098-01-01", endDate: "2098-01-31", effectiveDate: "2098-02-01", budgetPool: 5000000 });
  await refused(cycleBody(c.victim.org.id), 403, "victim employer cycle");
  let before = await state(c.orgId);
  const cycleResponse = await post(cycleBody(c.orgId), 201, "own cycle");
  let after = await state(c.orgId);
  const [cycle] = newRows(before, after, "cycles");
  assert.equal(newRows(before, after, "cycles").length, 1, "exactly one cycle is created");
  assert.equal(cycle.organizationId, c.orgId); assert.equal(cycle.status, "active"); assert.equal(cycle.createdByUserId, c.owner.id);
  assert.equal(cycleResponse.json?.id, cycle.id);
  only(before, after, "cycles"); receipt(before, after, "Compensation cycle created");

  // band: forged job profile, grade and legal employer are each refused; an overlap is refused.
  const bandBody = (organizationId, extra) => ({ organizationId, entityType: "band", jobProfileId: seed.profileId, legalEntityId: seed.entityId, locationCode: "PH",
    minimumAnnual: 120000, midpointAnnual: 240000, maximumAnnual: 360000, effectiveFrom: "2098-01-01", ...extra });
  await refused(bandBody(c.victim.org.id, { jobProfileId: vseed.profileId, legalEntityId: vseed.entityId }), 403, "victim employer band");
  await refused(bandBody(c.orgId, { jobProfileId: vseed.profileId }), 404, "forged victim job profile band");
  await refused(bandBody(c.orgId, { jobProfileId: null, gradeId: vseed.gradeId }), 404, "forged victim grade band");
  await refused(bandBody(c.orgId, { legalEntityId: vseed.entityId }), 404, "forged victim legal employer band");
  before = await state(c.orgId);
  const bandResponse = await post(bandBody(c.orgId), 201, "own band");
  after = await state(c.orgId);
  const [band] = newRows(before, after, "bands");
  assert.equal(newRows(before, after, "bands").length, 1, "exactly one band is created");
  assert.equal(band.organizationId, c.orgId); assert.equal(band.jobProfileId, seed.profileId); assert.equal(band.gradeId, seed.gradeId, "the grade is taken from the own job profile");
  assert.equal(band.legalEntityId, seed.entityId); assert.equal(band.active, true); assert.equal(band.createdByUserId, c.owner.id);
  assert.equal(bandResponse.json?.id, band.id);
  only(before, after, "bands"); receipt(before, after, "Compensation band created");
  await refused(bandBody(c.orgId), 409, "overlapping band");

  // component_assignment: a forged victim worker or component, a retroactive date and an overlap are refused.
  const assignBody = (organizationId, extra) => ({ organizationId, entityType: "component_assignment", employeeId: c.workerId, componentId: seed.componentId, amount: 1500,
    effectiveFrom: "2099-01-01", reason: c.marker + " recurring allowance", ...extra });
  await refused(assignBody(c.victim.org.id, { employeeId: c.victim.worker.id, componentId: vseed.componentId }), 403, "victim employer component_assignment");
  await refused(assignBody(c.orgId, { employeeId: c.victim.worker.id }), 404, "forged victim worker component_assignment");
  await refused(assignBody(c.orgId, { componentId: vseed.componentId }), 404, "forged victim component component_assignment");
  await refused(assignBody(c.orgId, { effectiveFrom: "2020-01-01" }), 409, "retroactive component_assignment");
  before = await state(c.orgId);
  const assignResponse = await post(assignBody(c.orgId), 201, "own component_assignment");
  after = await state(c.orgId);
  const [assignment] = newRows(before, after, "assignments");
  assert.equal(newRows(before, after, "assignments").length, 1, "exactly one assignment is created");
  assert.equal(assignment.organizationId, c.orgId); assert.equal(assignment.employeeId, c.workerId); assert.equal(assignment.componentId, seed.componentId);
  assert.equal(assignment.status, "pending_approval", "a request is never approved by its own creation"); assert.equal(assignment.requestedByUserId, c.owner.id);
  assert.equal(assignResponse.json?.id, assignment.id);
  only(before, after, "assignments"); receipt(before, after, "Recurring compensation component requested");
  await refused(assignBody(c.orgId), 409, "overlapping component_assignment");

  // proposal: references the cycle and band created above; it starts an independent HCM review and never schedules pay.
  const proposalBody = (organizationId, extra) => ({ organizationId, entityType: "proposal", employeeId: c.workerId, cycleId: cycle.id, bandId: band.id,
    proposedAnnual: 300000, reason: c.marker + " fictional merit proposal", ...extra });
  await refused(proposalBody(c.victim.org.id, { employeeId: c.victim.worker.id }), 403, "victim employer proposal");
  await refused(proposalBody(c.orgId, { employeeId: c.victim.worker.id }), 404, "forged victim worker proposal");
  await refused(proposalBody(c.orgId, { bandId: band.id + 100000 }), 404, "a band that does not exist for this employer");
  await refused(proposalBody(c.orgId, { proposedAnnual: 999999999 }), 400, "a proposal outside the salary band");
  before = await state(c.orgId);
  const proposalResponse = await post(proposalBody(c.orgId), 201, "own proposal");
  after = await state(c.orgId);
  const [proposal] = newRows(before, after, "proposals");
  assert.equal(newRows(before, after, "proposals").length, 1, "exactly one proposal is created");
  assert.equal(proposal.organizationId, c.orgId); assert.equal(proposal.employeeId, c.workerId); assert.equal(proposal.cycleId, cycle.id); assert.equal(proposal.bandId, band.id);
  assert.equal(proposal.status, "proposed", "a proposal waits for independent review"); assert.equal(proposal.submittedByUserId, c.owner.id);
  assert.equal(Number(proposal.proposedAnnual), 300000); assert.equal(proposal.scheduledAt, null); assert.equal(proposal.appliedAt, null);
  assert.equal(proposalResponse.json?.id, proposal.id); assert.equal(proposalResponse.json?.approvalRequired, true);
  const review = newRows(before, after, "reviews");
  assert.equal(review.length, 1, "exactly one independent HCM review starts"); assert.equal(review[0].organizationId, c.orgId);
  assert.equal(review[0].sourceType, "compensation_proposal"); assert.equal(review[0].sourceKey, String(proposal.id));
  assert.notEqual(review[0].status, "approved", "a new review is never pre-approved");
  assert.deepEqual(after.revisions, before.revisions, "no pay revision is created"); assert.deepEqual(after.payProfiles, before.payProfiles, "no pay profile changes");
  assert.deepEqual(after.runs, before.runs, "no payroll run is touched");
  receipt(before, after, "Compensation proposal submitted for independent HCM review");
  await refused(proposalBody(c.orgId), 409, "a second proposal for the same worker and cycle");
  return { actions: ["cycle", "band", "component_assignment", "proposal"], forgedReferences: 8, victimEmployerDenials: 4 };
}
