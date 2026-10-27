import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requireDisposableDevelopmentPlans } from "../../scripts/qa/tenant-batches/ess-development-guard.mjs";
import {
  proveOwnDevelopmentRead, proveOwnMilestonePatch, proveOwnProgressPost, proveUnchanged,
} from "../../scripts/qa/tenant-batches/ess-development-assertions.mjs";

const good = {
  CI: "true", NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", WORKER_TOKEN: "fictional-synthetic-token",
};
test("fail-closed disposable preflight guards DB, provider, worker and server targets", () => {
  assert.doesNotThrow(() => requireDisposableDevelopmentPlans(good, "seed"));
  assert.doesNotThrow(() => requireDisposableDevelopmentPlans(good, "prove"));
  for (const invalid of [
    { CI: "false" }, { NODE_ENV: "development" },
    { TENANT_SECOND_PASS_MODE: "off" }, { WORKER_ENABLED: "true" },
    { CENTRAL_SCHEDULER_ENABLED: "true" }, { WORKER_TOKEN: undefined },
    { SECURITY_SMOKE_URL: "https://payroll.example.test/" },
    { SECURITY_SMOKE_URL: "http://127.0.0.1:3000/external" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/live_db" },
    { DATABASE_URL: "postgresql://prod:postgres@127.0.0.1:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?ssl=true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "secret" }, { XENDIT_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" }, { STRIPE_SECRET_KEY: "secret" },
  ]) {
    assert.throws(() => requireDisposableDevelopmentPlans({ ...good, ...invalid }, "prove"),
      "must reject non-disposable setup " + JSON.stringify(invalid));
  }
  assert.throws(() => requireDisposableDevelopmentPlans(good, "test"),
    "unknown stages must fail");
});

const time = new Date("2026-10-27T01:00:00.000Z");
const actor = {
  orgId: 13, workerId: 22, userId: 33, userName: "TTBL-ATTA employee",
  marker: "TTBL-ATTA", planId: 44, planTitle: "TTBL-ATTA development",
  skillId: 55, skillName: "TTBL-ATTA skill",
  milestoneId: 66, milestoneTitle: "TTBL-ATTA milestone",
  peerPlanId: 45, peerPlanTitle: "TTBL-ATTA-PEER private development",
  peerMilestoneId: 67, peerMilestoneTitle: "TTBL-ATTA-PEER milestone",
  seedProgressId: 77, seedProgressContent: "TTBL-ATTA initial fictional note",
  newProgressContent: "TTBL-ATTA new note",
};
const ownPlan = {
  id: actor.planId, organizationId: actor.orgId, employeeId: actor.workerId,
  title: actor.planTitle, employeeVisible: true, skillId: actor.skillId,
  skill: { id: actor.skillId, organizationId: actor.orgId, name: actor.skillName },
  milestones: [{ id: actor.milestoneId, title: actor.milestoneTitle, status: "open" }],
  progress: [{ id: actor.seedProgressId, content: actor.seedProgressContent,
    employeeId: actor.workerId }],
};
const readResponse = {
  status: 200, json: { plans: [ownPlan] }, text: JSON.stringify({ plans: [ownPlan] }),
};
test("non-empty own GET proof rejects another employer, peer or empty results", () => {
  assert.doesNotThrow(() => proveOwnDevelopmentRead(readResponse, actor));
  assert.throws(() => proveOwnDevelopmentRead(readResponse, { ...actor, orgId: 998 }));
  assert.throws(() => proveOwnDevelopmentRead(readResponse, { ...actor, planId: 999 }));
  assert.throws(() => proveOwnDevelopmentRead(readResponse, { ...actor, milestoneId: 999 }));
  assert.throws(() => proveOwnDevelopmentRead(readResponse, { ...actor, skillName: "other" }));
  assert.throws(() => proveOwnDevelopmentRead(
    { ...readResponse, json: { plans: [] }, text: "{}" }, actor));
  assert.throws(() => proveOwnDevelopmentRead(
    { ...readResponse, text: readResponse.text + actor.peerPlanTitle }, actor));
});
const before = {
  employees: [{ id: actor.workerId }], plans: [{ id: actor.planId }],
  skills: [{ id: actor.skillId }],
  milestones: [
    { id: actor.milestoneId, organizationId: actor.orgId,
      planId: actor.planId, title: actor.milestoneTitle, detail: null,
      dueDate: "2026-11-15", status: "open", createdAt: time, updatedAt: time,
      completedByUserId: null, completedByName: null, completedAt: null },
    { id: actor.peerMilestoneId, organizationId: actor.orgId,
      planId: actor.peerPlanId, status: "open" },
  ],
  progress: [{ id: actor.seedProgressId }],
  events: [], payroll: [], audit: [],
};
const postRow = {
  id: 100, organizationId: actor.orgId, planId: actor.planId,
  employeeId: actor.workerId, authorUserId: actor.userId,
  authorEmployeeId: actor.workerId, authorName: actor.userName,
  progressPercent: 37, content: actor.newProgressContent,
};
const posted = structuredClone(before);
posted.progress.push(postRow);
posted.audit.push({ id: 200, organizationId: actor.orgId, actor: actor.userName,
  action: "Employee added skill development progress", resource: actor.planTitle,
  metadata: { developmentPlanId: actor.planId, progressUpdateId: postRow.id, progressPercent: 37 } });
const postResponse = { status: 201, json: postRow };
test("POST proof rejects no-op success, wrong actor and lost audit", () => {
  assert.doesNotThrow(() => proveOwnProgressPost(before, posted, actor, postResponse));
  assert.throws(() => proveOwnProgressPost(before, before, actor, postResponse));
  assert.throws(() => proveOwnProgressPost(before, { ...posted, audit: [] }, actor, postResponse));
  assert.throws(() => proveOwnProgressPost(before,
    { ...posted, progress: [{ id: actor.seedProgressId }, { ...postRow, employeeId: 999 }] },
    actor, postResponse));
  assert.throws(() => proveOwnProgressPost(before,
    { ...posted, employees: [{ id: 999 }] }, actor, postResponse));
});
const patched = structuredClone(posted);
patched.milestones[0] = {
  ...patched.milestones[0], status: "completed",
  completedAt: new Date(time.getTime() + 2000), updatedAt: new Date(time.getTime() + 2000),
  completedByUserId: actor.userId, completedByName: actor.userName,
};
patched.audit.push({ id: 201, organizationId: actor.orgId, actor: actor.userName,
  action: "Employee completed development milestone", resource: actor.milestoneTitle,
  metadata: { developmentPlanId: actor.planId, milestoneId: actor.milestoneId, status: "completed" } });
const patchResponse = { status: 200, json: {
  id: actor.milestoneId, organizationId: actor.orgId,
  planId: actor.planId, status: "completed", completedByUserId: actor.userId,
} };
test("PATCH proof requires the exact milestone, checker and audit, no collateral", () => {
  assert.doesNotThrow(() => proveOwnMilestonePatch(posted, patched, actor, patchResponse));
  assert.throws(() => proveOwnMilestonePatch(posted, posted, actor, patchResponse));
  assert.throws(() => proveOwnMilestonePatch(posted, { ...patched, audit: posted.audit }, actor, patchResponse));
  assert.throws(() => proveOwnMilestonePatch(posted,
    { ...patched, milestones: patched.milestones.map((r, i) =>
      i === 0 ? { ...r, completedByUserId: 999 } : r) }, actor, patchResponse));
  assert.throws(() => proveOwnMilestonePatch(posted,
    { ...patched, milestones: patched.milestones.map((r, i) =>
      i === 1 ? { ...r, status: "completed" } : r) }, actor, patchResponse));
  assert.doesNotThrow(() => proveUnchanged(before, structuredClone(before), "denial"));
  assert.throws(() => proveUnchanged(before, posted, "denial"));
});
test("existing route retains session-linked employer and worker write predicates", () => {
  const route = readFileSync("src/app/api/self/performance/development-plans/route.ts", "utf8");
  assert.match(route, /session\.role !== "employee" \|\| !session\.employeeId/);
  assert.match(route, /assertMembership\(session\.id, employee\.organizationId\)/);
  assert.match(route, /eq\(performanceSkillDevelopmentPlans\.employeeId, context\.employee\.id\)/);
  assert.match(route, /eq\(performanceSkillDevelopmentPlans\.organizationId, context\.employee\.organizationId\)/);
  assert.match(route, /eq\(performanceSkillDevelopmentMilestones\.organizationId, context\.employee\.organizationId\)/);
  assert.match(route, /eq\(performanceSkillDevelopmentPlans\.employeeVisible, true\)/);
});
