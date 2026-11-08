import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { auditBusinessSnapshot } from "./tenant-table-invariants.mjs";
import { METHODS, requireDisposablePerformanceHr, assertDenied, assertEquivalentNotFound, assertNewOwnedRow }
  from "./tenant-performance-hr-edge-contract.mjs";

// No DB import, remote HTTP, or fixture mutation is allowed before preflight.
requireDisposablePerformanceHr(process.env);
const { db, pool } = await import("../../src/db/index.ts");
const t = await import("../../src/db/schema.ts");
const { seedEmployer, standaloneMakeSession, standaloneRequest, standaloneExpectStatus }
  = await import("./tenant-table-http.mjs");

const plain = x => JSON.parse(JSON.stringify(x));
const names = [...new Set([
  ...Object.keys(t).filter(name => name.startsWith("performance") && t[name]?.organizationId),
  "employees", "hcmSkills", "userOrganizations", "auditEvents", "payrollRuns", "employeePayProfiles",
])];

async function snapshot(orgId) {
  const out = {};
  for (const name of names) {
    const rows = await db.select().from(t[name]).where(eq(t[name].organizationId, orgId)).orderBy(asc(t[name].id));
    out[name] = plain(name === "auditEvents" ? auditBusinessSnapshot(rows) : rows);
  }
  return out;
}
async function insert(e, name, props) {
  const [row] = await db.insert(t[name]).values({ organizationId: e.org.id, ...props }).returning();
  assert.ok(row && Number.isSafeInteger(row.id) && row.id > 0, "fixture must be persisted: " + name);
  return row;
}
async function fixture(label, nonce) {
  const e = await seedEmployer(label, nonce, standaloneMakeSession);
  const peerUnit = await insert(e, "orgUnits", {
    legalEntityId: e.entity.id, type: "department", code: e.marker + "-PEER",
    name: e.marker + " unrelated unit",
  });
  const peerWorker = await insert(e, "employees", {
    legalEntityId: e.entity.id, orgUnitId: peerUnit.id, employeeNo: e.marker + "-PEER",
    firstName: "Other", lastName: e.marker, title: "Fictional peer", avatarInitials: "FP",
    basicRate: "20000.00", startDate: "2026-01-05",
  });
  const [manager] = await db.insert(t.users).values({
    name: e.marker + " manager", email: (e.marker + "-mgr@example.invalid").toLowerCase(),
    passwordHash: "fictional-no-password", role: "manager", active: true, totpEnabled: true,
  }).returning();
  await db.insert(t.userOrganizations).values({
    userId: manager.id, organizationId: e.org.id, role: "manager", orgUnitId: e.unit.id, active: true,
  });
  const session = await standaloneMakeSession(manager.id);
  await db.update(t.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(t.sessions.id, session.id));
  const skill = await insert(e, "hcmSkills", { code: e.marker + "-EDGE", name: e.marker + " skill" });
  const template = await insert(e, "performanceTemplates", {
    code: e.marker + "-EDGE", name: e.marker + " competency template", type: "competency",
  });
  const goal = await insert(e, "performanceGoals", {
    scope: "employee", employeeId: e.worker.id, title: e.marker + " goal",
  });
  const peerGoal = await insert(e, "performanceGoals", {
    scope: "employee", employeeId: peerWorker.id, title: e.marker + " peer goal",
  });
  const cycles = [];
  for (const [startDate, endDate] of [["2026-01-01", "2026-02-01"], ["2026-02-02", "2026-03-01"]]) {
    const cycle = await insert(e, "performanceCycles", {
      name: e.marker + startDate, startDate, endDate, status: "completed",
    });
    const review = await insert(e, "performanceReviews", {
      employeeId: e.worker.id, cycleId: cycle.id, status: "completed", finalScore: "2.00",
    });
    await insert(e, "performanceReviewItems", {
      reviewId: review.id, templateId: template.id, skillId: skill.id,
      expectedProficiency: 4, finalScore: "2.00",
    });
    cycles.push(cycle);
  }
  const peerPlan = await insert(e, "performanceSkillDevelopmentPlans", {
    employeeId: peerWorker.id, skillId: skill.id,
    title: e.marker + " other unit plan",
    objective: "Fictional employee growth target for unit-boundary testing",
    targetProficiency: "4.00", targetDate: "2099-12-31",
    createdByUserId: e.owner.id, createdByName: e.owner.name,
  });
  return { ...e, manager, cookie: session.cookie, skill, cycles, goal,
    peerGoal, peerWorker, peerUnit, peerPlan };
}

let victim, victimBefore;
const successes = new Map(), observations = [];
function assertAudit(before, after, actor, action) {
  const added = after.auditEvents.filter(r => !before.auditEvents.some(old => old.id === r.id));
  assert.equal(added.length, 1, "one audit row must be persisted");
  assert.equal(added[0].organizationId, actor.org.id);
  assert.equal(added[0].actor, actor.manager.name);
  assert.equal(added[0].action, action);
}
function assertEvent(before, after, actor, planId, type) {
  const added = after.performanceSkillDevelopmentPlanEvents.filter(
    r => !before.performanceSkillDevelopmentPlanEvents.some(old => old.id === r.id));
  assert.equal(added.length, 1, "one plan event must be persisted");
  assert.equal(added[0].organizationId, actor.org.id);
  assert.equal(added[0].actorUserId, actor.manager.id);
  assert.equal(added[0].planId, planId);
  assert.equal(added[0].eventType, type);
}
async function step(actor, route, body, cfg) {
  const path = "/api/" + route, label = actor.label + " " + route + " " + body.entityType;
  const before = await snapshot(actor.org.id);
  const owned = standaloneExpectStatus(await standaloneRequest(path, {
    method: "POST", cookie: actor.cookie, body,
  }), 201, label + " real owned POST");
  assert.ok(!owned.text.includes(victim.marker), "owned response leaks victim");
  const after = await snapshot(actor.org.id);
  const row = assertNewOwnedRow(before[cfg.table], after[cfg.table], owned,
    { organizationId: actor.org.id, ...cfg.expected });
  assert.deepEqual(after.payrollRuns, before.payrollRuns, "no payroll run change");
  assert.deepEqual(after.employeePayProfiles, before.employeePayProfiles, "no pay-profile change");
  if (cfg.audit) assertAudit(before, after, actor, cfg.audit);
  if (cfg.event) assertEvent(before, after, actor, cfg.eventPlanId?.(row) ?? row.id, cfg.event);
  const key = route + ":" + body.entityType, previous = successes.get(key);
  if (!previous) successes.set(key, { before: before[cfg.table], after: after[cfg.table], owned });
  else assert.throws(() => assertNewOwnedRow(previous.before, previous.after, previous.owned,
    { organizationId: actor.org.id, ...cfg.expected }), "another employer must not satisfy own-data proof");

  const deny = async (changes, status) => assertDenied(await standaloneRequest(path, {
    method: "POST", cookie: actor.cookie, body: { ...body, ...changes },
  }), status, [victim.marker, victim.owner.name]);
  await deny({ organizationId: victim.org.id, ...cfg.foreign }, 403);
  const realForeign = await standaloneRequest(path, { method: "POST", cookie: actor.cookie,
    body: { ...body, ...cfg.forged } });
  const nonexistent = await standaloneRequest(path, { method: "POST", cookie: actor.cookie,
    body: { ...body, ...cfg.absent } });
  assertEquivalentNotFound(realForeign, nonexistent, [victim.marker, victim.owner.name]);
  await deny(cfg.peer, 403);
  if (cfg.extra) await deny(cfg.extra, 404);
  assertDenied(await standaloneRequest(path, { method: "POST", body }), 401, [victim.marker]);
  assert.deepEqual(await snapshot(actor.org.id), after, "denial modified caller HR/payroll/audit");
  assert.deepEqual(await snapshot(victim.org.id), victimBefore, "denial modified victim SQL/audit");
  observations.push({
    method: "POST " + route, action: body.entityType, actor: actor.label, status: 201,
    foreignEmployer: 403, foreignRecord: 404, absentRecord: 404, peerUnit: 403,
    revokedPending: true, unchangedVictim: true,
  });
  return row;
}

async function runActor(a) {
  const meeting = { organizationId: a.org.id, entityType: "one_on_one",
    employeeId: a.worker.id, scheduledFor: "2099-12-31T09:00:00Z",
    agenda: a.marker + " fictional unit-level check-in" };
  await step(a, "performance/continuous", meeting, {
    table: "performanceOneOnOnes", expected: {
      employeeId: a.worker.id, managerUserId: a.manager.id,
      status: "scheduled", agenda: meeting.agenda },
    audit: "Performance 1:1 scheduled",
    foreign: { employeeId: victim.worker.id },
    forged: { employeeId: victim.worker.id }, absent: { employeeId: 2147483647 },
    peer: { employeeId: a.peerWorker.id },
  });

  const feedback = { organizationId: a.org.id, entityType: "feedback",
    employeeId: a.worker.id, goalId: a.goal.id, feedbackType: "development",
    visibility: "manager_private", content: a.marker + " fictional feedback" };
  await step(a, "performance/continuous", feedback, {
    table: "performanceFeedback", expected: {
      employeeId: a.worker.id, goalId: a.goal.id,
      authorUserId: a.manager.id, visibility: "manager_private", content: feedback.content },
    audit: "Performance feedback recorded",
    foreign: { employeeId: victim.worker.id, goalId: victim.goal.id },
    forged: { employeeId: victim.worker.id }, absent: { employeeId: 2147483647 },
    peer: { employeeId: a.peerWorker.id, goalId: a.peerGoal.id },
    extra: { goalId: victim.goal.id },
  });

  const createPlan = { organizationId: a.org.id, entityType: "plan",
    employeeId: a.worker.id, skillId: a.skill.id, targetProficiency: 4,
    title: a.marker + " verified development plan",
    objective: a.marker + " fictional improvement across two completed review cycles",
    targetDate: "2099-12-31" };
  const plan = await step(a, "performance/development-plans", createPlan, {
    table: "performanceSkillDevelopmentPlans", expected: {
      employeeId: a.worker.id, skillId: a.skill.id, title: createPlan.title,
      sourceCycleId: a.cycles[1].id, currentProficiency: "2.00",
      targetProficiency: "4.00", createdByUserId: a.manager.id },
    event: "created", audit: "Skill development plan created",
    foreign: { employeeId: victim.worker.id, skillId: victim.skill.id },
    forged: { employeeId: victim.worker.id }, absent: { employeeId: 2147483647 },
    peer: { employeeId: a.peerWorker.id }, extra: { skillId: victim.skill.id },
  });
  const milestone = { organizationId: a.org.id, entityType: "milestone",
    planId: plan.id, title: a.marker + " learning milestone",
    detail: "Fictional development task without notifications", dueDate: "2099-12-20" };
  await step(a, "performance/development-plans", milestone, {
    table: "performanceSkillDevelopmentMilestones",
    expected: { planId: plan.id, title: milestone.title, dueDate: milestone.dueDate, status: "open" },
    event: "milestone_created", eventPlanId: () => plan.id,
    foreign: { planId: victim.peerPlan.id },
    forged: { planId: victim.peerPlan.id }, absent: { planId: 2147483647 },
    peer: { planId: a.peerPlan.id },
  });

  const revoked = await db.update(t.userOrganizations).set({ active: false }).where(and(
    eq(t.userOrganizations.userId, a.manager.id),
    eq(t.userOrganizations.organizationId, a.org.id),
    eq(t.userOrganizations.active, true),
  )).returning();
  assert.equal(revoked.length, 1, "one active manager membership must be revoked");
  const inactive = await db.select({ id: t.userOrganizations.id }).from(t.userOrganizations).where(and(
    eq(t.userOrganizations.userId, a.manager.id),
    eq(t.userOrganizations.organizationId, a.org.id),
    eq(t.userOrganizations.active, false),
  )).limit(1);
  assert.equal(inactive.length, 1, "revocation persisted");
  const afterRevoke = await snapshot(a.org.id);
  for (const body of [meeting, feedback, createPlan, milestone]) {
    const route = ["one_on_one", "feedback"].includes(body.entityType)
      ? "performance/continuous" : "performance/development-plans";
    const denied = await standaloneRequest("/api/" + route, {
      method: "POST", cookie: a.cookie, body,
    });
    assert.ok([401, 403].includes(denied.status), "revoked manager must not perform a write");
    assert.ok(!denied.text.includes(victim.marker), "revoked denial leaks victim marker");
    assert.deepEqual(await snapshot(a.org.id), afterRevoke, "revoked manager changed employer data");
    assert.deepEqual(await snapshot(victim.org.id), victimBefore, "revoked manager changed victim");
  }
}

try {
  const dbName = await pool.query("SELECT current_database() AS name");
  const version = await pool.query("SHOW server_version_num");
  const empty = await pool.query("SELECT count(*)::int AS n FROM organizations");
  assert.equal(dbName.rows[0].name, "app_db");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16);
  assert.equal(empty.rows[0].n, 0, "new empty disposable PG16 instance required");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const actors = [await fixture("ATTA", nonce), await fixture("ATTB", nonce)];
  victim = await fixture("VICTIM", nonce);
  for (const field of ["org", "worker", "unit", "peerWorker", "peerPlan", "goal", "skill"]) {
    assert.ok(victim[field].id > actors[0][field].id && victim[field].id > actors[1][field].id,
      "victim must have actual higher " + field + " ID");
  }
  victimBefore = await snapshot(victim.org.id);
  for (const a of actors) await runActor(a);
  const expected = Object.entries(METHODS).flatMap(([method, actions]) =>
    actions.flatMap(action => actors.map(actor => method + "/" + action + "/" + actor.label)));
  const actual = observations.map(r => r.method + "/" + r.action + "/" + r.actor);
  assert.deepEqual(actual.sort(), expected.sort(), "two separate managers for every POST action");
  assert.deepEqual(await snapshot(victim.org.id), victimBefore, "final victim HR/payroll/audit immutable");
  const receipt = { kind: "tenant-performance-hr-edge-http-v1",
    methods: Object.keys(METHODS), cases: observations, postgresMajor: 16,
    actionPositives: observations.length, revokedMembershipDenials: 8,
    genuineHigherIdVictim: true, victimDatabaseUnchanged: true,
    coverageCredits: 0, productionTested: false, independentlyAccepted: false };
  mkdirSync("outputs", { recursive: true });
  writeFileSync("outputs/tenant-performance-hr-edge.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally {
  await pool.end();
}
