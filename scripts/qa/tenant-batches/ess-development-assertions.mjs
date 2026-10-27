import assert from "node:assert/strict";

/** An empty successful read, wrong employee or wrong nested record is not a proof. */
export function proveOwnDevelopmentRead(response, actor) {
  assert.equal(response.status, 200, "own development GET must succeed");
  assert.ok(Array.isArray(response.json?.plans) &&
    response.json.plans.length === 1, "a populated, single visible own plan is required");
  const plan = response.json.plans[0];
  assert.equal(plan.id, actor.planId);
  assert.equal(plan.organizationId, actor.orgId);
  assert.equal(plan.employeeId, actor.workerId);
  assert.equal(plan.title, actor.planTitle);
  assert.equal(plan.employeeVisible, true);
  assert.equal(plan.skillId, actor.skillId);
  assert.equal(plan.skill?.id, actor.skillId);
  assert.equal(plan.skill?.organizationId, actor.orgId);
  assert.equal(plan.skill?.name, actor.skillName);
  assert.ok(Array.isArray(plan.milestones) && plan.milestones.length === 1);
  assert.equal(plan.milestones[0].id, actor.milestoneId);
  assert.equal(plan.milestones[0].title, actor.milestoneTitle);
  assert.equal(plan.milestones[0].status, "open");
  assert.ok(Array.isArray(plan.progress) && plan.progress.length === 1);
  assert.equal(plan.progress[0].id, actor.seedProgressId);
  assert.equal(plan.progress[0].content, actor.seedProgressContent);
  assert.equal(plan.progress[0].employeeId, actor.workerId);
  assert.ok(!response.text.includes(actor.peerPlanTitle),
    "other worker's real plan title must not appear");
  assert.ok(!response.text.includes(actor.peerMilestoneTitle),
    "other worker's milestone must not appear");
}

export function proveUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": tenant data and business audit must remain unchanged");
}

function auditAdded(before, after, actor, action, resource, metadata) {
  assert.equal(after.audit.length, before.audit.length + 1,
    "exactly one new actor-bound audit record");
  const added = after.audit.filter(row => !before.audit.some(old => old.id === row.id));
  assert.equal(added.length, 1);
  assert.deepEqual(after.audit.filter(row => row.id !== added[0].id), before.audit,
    "all previous audits remain unchanged");
  assert.equal(added[0].organizationId, actor.orgId);
  assert.equal(added[0].actor, actor.userName);
  assert.equal(added[0].action, action);
  assert.equal(added[0].resource, resource);
  assert.deepEqual(added[0].metadata, metadata);
}

function allOtherTablesUnchanged(before, after, except) {
  for (const key of ["employees", "plans", "skills", "milestones", "progress",
    "payroll", "events"]) {
    if (key !== except) assert.deepEqual(after[key], before[key], key + " changed unexpectedly");
  }
}

/** POST must create exactly one persisted progress row and actor-bound audit. */
export function proveOwnProgressPost(before, after, actor, response) {
  assert.equal(response.status, 201, "own progress POST must return 201");
  allOtherTablesUnchanged(before, after, "progress");
  assert.equal(after.progress.length, before.progress.length + 1);
  const added = after.progress.filter(row => !before.progress.some(old => old.id === row.id));
  assert.equal(added.length, 1);
  assert.deepEqual(after.progress.filter(row => row.id !== added[0].id), before.progress);
  const row = added[0];
  assert.equal(response.json?.id, row.id);
  assert.equal(response.json?.organizationId, actor.orgId);
  assert.equal(response.json?.planId, actor.planId);
  assert.equal(response.json?.employeeId, actor.workerId);
  assert.equal(row.organizationId, actor.orgId);
  assert.equal(row.planId, actor.planId);
  assert.equal(row.employeeId, actor.workerId);
  assert.equal(row.authorUserId, actor.userId);
  assert.equal(row.authorEmployeeId, actor.workerId);
  assert.equal(row.authorName, actor.userName);
  assert.equal(row.progressPercent, 37);
  assert.equal(row.content, actor.newProgressContent);
  auditAdded(before, after, actor, "Employee added skill development progress",
    actor.planTitle, { developmentPlanId: actor.planId,
      progressUpdateId: row.id, progressPercent: 37 });
}

/** PATCH must complete only its own milestone; no peer or foreign mutations. */
export function proveOwnMilestonePatch(before, after, actor, response) {
  assert.equal(response.status, 200, "own milestone PATCH must return 200");
  allOtherTablesUnchanged(before, after, "milestones");
  assert.equal(after.milestones.length, before.milestones.length);
  const old = before.milestones.find(row => row.id === actor.milestoneId);
  const updated = after.milestones.find(row => row.id === actor.milestoneId);
  assert.ok(old && updated, "real own milestone must exist before and after");
  assert.deepEqual(after.milestones.filter(row => row.id !== actor.milestoneId),
    before.milestones.filter(row => row.id !== actor.milestoneId),
    "peer milestone must be unchanged");
  assert.equal(old.status, "open");
  assert.equal(updated.status, "completed");
  assert.equal(updated.organizationId, actor.orgId);
  assert.equal(updated.planId, actor.planId);
  assert.equal(updated.completedByUserId, actor.userId);
  assert.equal(updated.completedByName, actor.userName);
  assert.ok(updated.completedAt instanceof Date && Number.isFinite(updated.completedAt.getTime()));
  assert.ok(updated.updatedAt instanceof Date && updated.updatedAt.getTime() >= old.updatedAt.getTime());
  for (const key of ["id", "organizationId", "planId", "title", "detail", "dueDate",
    "createdAt"]) assert.deepEqual(updated[key], old[key], key + " is immutable");
  assert.equal(response.json?.id, actor.milestoneId);
  assert.equal(response.json?.organizationId, actor.orgId);
  assert.equal(response.json?.planId, actor.planId);
  assert.equal(response.json?.status, "completed");
  assert.equal(response.json?.completedByUserId, actor.userId);
  auditAdded(before, after, actor, "Employee completed development milestone",
    actor.milestoneTitle, { developmentPlanId: actor.planId,
      milestoneId: actor.milestoneId, status: "completed" });
}
