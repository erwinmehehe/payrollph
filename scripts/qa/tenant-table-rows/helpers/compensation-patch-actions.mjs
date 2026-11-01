/**
 * PATCH compensation: every action except the row's own proposal `declined`. Recurring-component assignments (approve, decline,
 * cancel) and governed salary proposals (approved, cancel of a proposed and of a scheduled change, retry). Fictional employers only.
 * The cycle, band and proposals are created through the real POST routes; the independent HCM review that a salary approval
 * requires is marked approved directly in PostgreSQL (a seeded state standing in for that separate flow), and a second admin
 * approves. Pay changes are scheduled for 2098, so no payroll run is touched and nothing is applied. Every refusal (victim
 * employer, maker-checker, wrong state) must leave the own employer and the victim byte-identical.
 * Lives outside write/ so the family loader does not treat it as a row file.
 */
import { createHash, randomBytes } from "node:crypto";

let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

/** Called from the row's seed: a graded profile with a primary position, components, a second admin and four pending assignments. */
export async function seedCompensationPatch({ db }, e) {
  const t = await tables();
  // Reuse the POST fixture's active primary assignment if it has been seeded.
  const postFixture = e.seeded?.["POST compensation"];
  const reusedPostFixture = Boolean(postFixture && Number.isSafeInteger(postFixture.profileId)
    && postFixture.profileId > 0 && postFixture.entityId === e.entity.id);
  let profile;
  if (reusedPostFixture) {
    profile = { id: postFixture.profileId };
  } else {
    // Standalone PATCH retains its original synthetic primary-position setup.
    const [grade] = await db.insert(t.jobGrades).values({ organizationId: e.org.id, code: ("PG" + e.marker).slice(-38).toUpperCase(), name: e.marker + " patch grade" }).returning();
    const [created] = await db.insert(t.jobProfiles).values({ organizationId: e.org.id, title: e.marker + " patch profile", gradeId: grade.id }).returning();
    profile = created;
    const [position] = await db.insert(t.positions).values({ organizationId: e.org.id, code: ("PP-" + e.marker).slice(-46), jobProfileId: profile.id,
      orgUnitId: e.unit.id, legalEntityId: e.entity.id, employmentType: "Regular", status: "filled", annualBudget: "0" }).returning();
    await db.insert(t.positionAssignments).values({ organizationId: e.org.id, positionId: position.id, employeeId: e.worker.id,
      assignmentType: "primary", fte: "1.0000", effectiveFrom: "2026-01-05", reason: "fixture" });
  }
  // A second company admin: maker-checker means the request and the approval need two different people.
  const [admin] = await db.insert(t.users).values({ email: e.marker.toLowerCase() + "-comp-admin@example.invalid", name: e.marker + " second compensation admin",
    passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
  await db.insert(t.userOrganizations).values({ userId: admin.id, organizationId: e.org.id, role: "admin", active: true });
  const raw = randomBytes(32).toString("hex");
  await db.insert(t.sessions).values({ userId: admin.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date() });
  const assignments = {};
  for (const [name, requestedBy] of [["approve", admin], ["decline", admin], ["cancel", admin], ["self", { id: e.owner.id, name: e.owner.name }]]) {
    const [component] = await db.insert(t.compensationComponents).values({ organizationId: e.org.id, code: (name.toUpperCase() + e.marker).slice(-38).toUpperCase(),
      name: e.marker + " " + name + " component", kind: "allowance", amountFrequency: "monthly" }).returning();
    const [row] = await db.insert(t.employeeCompensationComponents).values({ organizationId: e.org.id, employeeId: e.worker.id, componentId: component.id,
      amount: "1200.00", effectiveFrom: "2099-03-01", status: "pending_approval", reason: e.marker + " " + name, requestedByUserId: requestedBy.id, requestedBy: requestedBy.name }).returning();
    assignments[name] = row.id;
  }
  return { profileId: profile.id, entityId: e.entity.id, reusedPostFixture, adminId: admin.id, adminName: admin.name, adminCookie: "__Host-linaw_session=" + raw, assignments };
}

export async function compensationPatchActions({ assert, state, db, eq, hcmBusinessProcessInstances, compensationProposals }, c, { request, expectStatus, cookie }) {
  const url = "/api/compensation";
  const call = async (method, body, status, label, who = cookie) => expectStatus(await request(url, { method, cookie: who, body }), status, label);
  const patch = (body, status, label, who) => call("PATCH", body, status, label, who);
  const victimBefore = await state(c.victim.org.id);
  const refused = async (method, body, status, label, who = cookie) => {
    const own = await state(c.orgId);
    const response = await call(method, body, status, label, who);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await state(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await state(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
    return response;
  };
  const only = (before, after, ...changed) => {
    for (const key of Object.keys(before).filter((name) => !changed.includes(name) && name !== "audits")) assert.deepEqual(after[key], before[key], key + " must not change");
  };
  const receipt = (before, after, action, actorName = c.owner.name) => {
    const added = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id));
    assert.deepEqual(after.audits.filter((row) => before.audits.some((old) => old.id === row.id)), before.audits, "earlier audit rows are unchanged");
    for (const row of added) { assert.equal(row.organizationId, c.orgId); assert.equal(row.actor, actorName); }
    assert.equal(added.filter((row) => row.action === action).length, 1, "exactly one audit receipt: " + action);
  };
  const find = (rows, id) => rows.find((row) => row.id === id);
  const newRows = (before, after, key) => after[key].filter((row) => !before[key].some((old) => old.id === row.id));
  const extras = c.seeded.extras, vextras = c.victimSeeded.extras;
  const assignmentBody = (id, action) => ({ entityType: "component_assignment", id, action });

  // ---- recurring component assignments ---------------------------------------------------------------------------------
  for (const action of ["approve", "decline", "cancel"]) {
    await refused("PATCH", assignmentBody(vextras.assignments[action], action), 403, "victim employer assignment " + action);
  }
  await refused("PATCH", assignmentBody(extras.assignments.self, "approve"), 403, "maker-checker: the requester approving their own component");
  let before = await state(c.orgId);
  await patch(assignmentBody(extras.assignments.approve, "approve"), 200, "own assignment approve");
  let after = await state(c.orgId);
  let row = find(after.assignments, extras.assignments.approve);
  assert.equal(find(before.assignments, row.id).status, "pending_approval"); assert.equal(row.status, "scheduled", "a future component is scheduled, not active");
  assert.equal(row.organizationId, c.orgId); assert.equal(row.approvedByUserId, c.owner.id); assert.notEqual(row.requestedByUserId, c.owner.id, "the maker is not the approver");
  assert.deepEqual(after.assignments.filter((a) => a.id !== row.id), before.assignments.filter((a) => a.id !== row.id), "only the decided assignment changes");
  const approveEvents = newRows(before, after, "events");
  assert.equal(approveEvents.length, 1); assert.equal(approveEvents[0].eventType, "component_scheduled"); assert.equal(approveEvents[0].componentAssignmentId, row.id);
  only(before, after, "assignments", "events"); receipt(before, after, "Recurring compensation component approved and scheduled");

  before = after;
  await patch(assignmentBody(extras.assignments.decline, "decline"), 200, "own assignment decline");
  after = await state(c.orgId);
  row = find(after.assignments, extras.assignments.decline);
  assert.equal(row.status, "declined"); assert.equal(row.approvedByUserId, c.owner.id); assert.equal(newRows(before, after, "events").length, 0, "a decline records no financial event");
  only(before, after, "assignments"); receipt(before, after, "Recurring compensation component declined");

  before = after;
  await patch(assignmentBody(extras.assignments.cancel, "cancel"), 200, "own assignment cancel (pending)");
  after = await state(c.orgId);
  row = find(after.assignments, extras.assignments.cancel);
  assert.equal(row.status, "cancelled"); assert.equal(row.cancelledByUserId, c.owner.id);
  assert.equal(newRows(before, after, "events")[0].eventType, "component_cancelled");
  only(before, after, "assignments", "events"); receipt(before, after, "Recurring compensation component cancelled");

  before = after;
  await patch(assignmentBody(extras.assignments.approve, "cancel"), 200, "own assignment cancel (scheduled)");
  after = await state(c.orgId);
  assert.equal(find(after.assignments, extras.assignments.approve).status, "cancelled", "a scheduled component can still be cancelled before its effective date");
  only(before, after, "assignments", "events"); receipt(before, after, "Recurring compensation component cancelled");
  await refused("PATCH", assignmentBody(extras.assignments.decline, "approve"), 409, "approving an already declined component");

  // ---- governed salary proposals ---------------------------------------------------------------------------------------
  const make = async (entityType, extra) => (await call("POST", { organizationId: c.orgId, entityType, ...extra }, 201, "create " + entityType)).json;
  const cycleFor = (month) => make("cycle", { name: c.marker + " patch cycle " + month, startDate: "2098-01-01", endDate: "2098-01-31", effectiveDate: "2098-" + month + "-01", budgetPool: 5000000 });
  const [cycleX, cycleY, cycleZ] = [await cycleFor("02"), await cycleFor("03"), await cycleFor("04")];
  // Reuse the preexisting POST band rather than create an overlapping active band.
  const postBand = (await state(c.orgId)).bands.find((b) => b.active
    && b.jobProfileId === extras.profileId && b.legalEntityId === extras.entityId
    && b.locationCode === "PH" && String(b.effectiveFrom) <= "2098-02-01"
    && (!b.effectiveUntil || String(b.effectiveUntil) >= "2098-04-01"));
  if (extras.reusedPostFixture) assert.ok(postBand, "the POST band must cover this worker profile");
  const band = postBand ?? await make("band", { jobProfileId: extras.profileId, legalEntityId: extras.entityId, locationCode: "PH", minimumAnnual: 120000, midpointAnnual: 240000, maximumAnnual: 360000, effectiveFrom: "2098-01-01" });
  const propose = async (cycle, proposedAnnual) => (await call("POST", { organizationId: c.orgId, entityType: "proposal", employeeId: c.workerId, cycleId: cycle.id, bandId: band.id,
    proposedAnnual, reason: c.marker + " fictional proposal " + cycle.id }, 201, "create proposal")).json;
  const proposalX = await propose(cycleX, 300000), proposalY = await propose(cycleY, 310000);
  const decide = (id, decision) => ({ entityType: "proposal", id, decision });

  for (const decision of ["approved", "cancel", "retry"]) {
    await refused("PATCH", decide(c.victimSeeded.id, decision), 403, "victim employer proposal " + decision);
  }
  // approved: refused until an independent HCM review is approved, refused for the submitter, then scheduled by a second admin.
  const response409 = await refused("PATCH", decide(proposalX.id, "approved"), 409, "approving before the independent HCM review is approved", extras.adminCookie);
  assert.equal(response409.json?.businessProcessStatus !== "approved", true, "the refusal reports the review state");
  const [review] = (await state(c.orgId)).reviews.filter((r) => r.sourceType === "compensation_proposal" && r.sourceKey === String(proposalX.id));
  assert.ok(review && review.organizationId === c.orgId, "the proposal started an own-employer HCM review");
  await db.update(hcmBusinessProcessInstances).set({ status: "approved" }).where(eq(hcmBusinessProcessInstances.id, review.id));
  await refused("PATCH", decide(proposalX.id, "approved"), 403, "maker-checker: the submitter approving their own proposal");
  before = await state(c.orgId);
  const approved = await patch(decide(proposalX.id, "approved"), 200, "second admin approves the proposal", extras.adminCookie);
  after = await state(c.orgId);
  row = find(after.proposals, proposalX.id);
  assert.equal(find(before.proposals, row.id).status, "proposed"); assert.equal(row.status, "scheduled"); assert.equal(row.approvedByUserId, extras.adminId);
  assert.notEqual(row.submittedByUserId, row.approvedByUserId, "two different people submitted and approved");
  assert.equal(approved.json?.scheduled, true);
  const revisions = newRows(before, after, "revisions");
  assert.equal(revisions.length, 1, "exactly one pay revision is scheduled"); assert.equal(revisions[0].organizationId, c.orgId); assert.equal(revisions[0].employeeId, c.workerId);
  assert.equal(revisions[0].effectiveDate, "2098-02-01"); assert.equal(row.appliedPayRevisionId, revisions[0].id);
  assert.deepEqual(after.payProfiles, before.payProfiles, "a future-dated change leaves the live pay profile untouched"); assert.deepEqual(after.runs, before.runs, "no payroll run is touched");
  assert.equal(find(after.reviews, review.id).status, "applied", "the approved HCM review is consumed");
  const scheduledEvents = newRows(before, after, "events");
  assert.equal(scheduledEvents.length, 1); assert.equal(scheduledEvents[0].eventType, "salary_change_scheduled"); assert.equal(scheduledEvents[0].proposalId, row.id);
  only(before, after, "proposals", "revisions", "reviews", "events"); receipt(before, after, "Compensation proposal approved and scheduled", extras.adminName);

  // cancel: of a scheduled change (its pay revision is removed) and of a proposed one (its HCM review is cancelled).
  before = after;
  await patch(decide(proposalX.id, "cancel"), 200, "cancel a scheduled proposal");
  after = await state(c.orgId);
  row = find(after.proposals, proposalX.id);
  assert.equal(row.status, "cancelled"); assert.equal(row.appliedPayRevisionId, null);
  assert.equal(after.revisions.length, before.revisions.length - 1, "the scheduled pay revision is removed"); assert.deepEqual(after.payProfiles, before.payProfiles);
  assert.equal(newRows(before, after, "events")[0].eventType, "salary_change_cancelled");
  only(before, after, "proposals", "revisions", "events"); receipt(before, after, "Scheduled compensation proposal cancelled");

  before = after;
  await patch(decide(proposalY.id, "cancel"), 200, "cancel a proposed proposal");
  after = await state(c.orgId);
  assert.equal(find(after.proposals, proposalY.id).status, "cancelled");
  const [reviewY] = after.reviews.filter((r) => r.sourceKey === String(proposalY.id));
  assert.equal(reviewY.status, "cancelled", "cancelling a proposal cancels its HCM review");
  assert.deepEqual(after.revisions, before.revisions, "a proposed change had no pay revision to remove");
  only(before, after, "proposals", "reviews", "events"); receipt(before, after, "Compensation proposal cancelled");
  await refused("PATCH", decide(proposalY.id, "retry"), 409, "retry of a proposal that did not fail");

  // retry: a failed application is rescheduled, and a future effective date is not applied early.
  const [failed] = await db.insert(compensationProposals).values({ organizationId: c.orgId, employeeId: c.workerId, bandId: band.id, cycleId: cycleZ.id,
    currentAnnual: "240000.00", proposedAnnual: "320000.00", reason: c.marker + " fictional failed", status: "failed", failure: "fixture failure", submittedByUserId: c.owner.id }).returning();
  before = await state(c.orgId);
  const retried = await patch(decide(failed.id, "retry"), 200, "retry a failed proposal");
  after = await state(c.orgId);
  row = find(after.proposals, failed.id);
  assert.equal(find(before.proposals, failed.id).status, "failed"); assert.equal(row.status, "scheduled"); assert.equal(row.failure, null);
  assert.deepEqual(retried.json?.applied, { skipped: true, reason: "not_due", proposal: retried.json.applied.proposal }, "a future effective date is not applied early");
  assert.deepEqual(after.revisions, before.revisions); assert.deepEqual(after.payProfiles, before.payProfiles); assert.deepEqual(after.runs, before.runs);
  only(before, after, "proposals");
  assert.deepEqual(await state(c.victim.org.id), victimBefore, "none of the own-employer decisions touched the victim");
  return { actions: ["assignment:approve", "assignment:decline", "assignment:cancel", "proposal:approved", "proposal:cancel(scheduled)", "proposal:cancel(proposed)", "proposal:retry"], victimEmployerDenials: 6, makerCheckerRefusals: 2 };
}
