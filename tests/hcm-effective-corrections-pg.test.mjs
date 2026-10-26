import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

test("governed correction lifecycle on guarded fictional PostgreSQL", { skip: process.env.HCM_CORRECTION_PG !== "1" }, async t => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5432"); assert.equal(url.pathname, "/app_db");
  assert.equal(process.env.CI, "true"); assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  const { db, pool } = await import("../src/db/index.ts");
  const schema = await import("../src/db/schema.ts");
  const { eq, and, asc } = await import("drizzle-orm");
  const { returnEffectiveChangeForCorrection: sendBack, resubmitEffectiveChangeCorrection: resubmit } = await import("../src/lib/hcm-effective-corrections.ts");
  const { advanceHcmBusinessProcessAfterApprovalTx: advance } = await import("../src/lib/hcm-business-process.ts");
  const helper = await import("../scripts/qa/tenant-table-http.mjs");
  const { createRows } = await import("../scripts/qa/tenant-table-rows/write/hcm-corrections.mjs");
  const rows = createRows({ assert, addWorker: helper.addWorker, auditBusinessSnapshot: value => value });
  const fresh = async returned => {
    const e = await helper.seedEmployer("ATTA", randomUUID().replaceAll("-", "").slice(0, 10), helper.standaloneMakeSession);
    const seeded = await rows[returned ? 1 : 0].seed(e);
    return { e, seeded, input: { organizationId: e.org.id, changeId: seeded.id, userId: e.owner.id, name: e.owner.name } };
  };
  const changes = org => db.select().from(schema.workerEffectiveChanges).where(eq(schema.workerEffectiveChanges.organizationId, org)).orderBy(asc(schema.workerEffectiveChanges.id));
  const state = async org => {
    const out = {};
    for (const [key, table] of Object.entries({ changes: schema.workerEffectiveChanges, processes: schema.hcmBusinessProcessInstances,
      steps: schema.hcmBusinessProcessInstanceSteps, tasks: schema.approvalTasks, workers: schema.employees, events: schema.workerEmploymentEvents,
      profiles: schema.employeePayProfiles, audits: schema.auditEvents })) out[key] = await db.select().from(table).where(eq(table.organizationId, org)).orderBy(asc(table.id));
    return out;
  };
  try {
    await t.test("real HTTP refuses missing MFA, cross-origin writes and non-People reads", async () => {
      const pending = await fresh(false), before = await state(pending.e.org.id);
      const bareSession = await helper.standaloneMakeSession(pending.e.owner.id);
      const body = { organizationId: pending.e.org.id, changeId: pending.seeded.id, note: "Correct the fictional requested date." };
      const mfa = await helper.standaloneRequest("/api/hcm/effective-change-corrections/return", { method: "POST", cookie: bareSession.cookie, body });
      assert.equal(mfa.status, 403);
      const origin = await fetch("http://127.0.0.1:3000/api/hcm/effective-change-corrections/return", { method: "POST",
        headers: { cookie: pending.e.cookie, origin: "https://forbidden.example.invalid", "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
      assert.equal(origin.status, 403); assert.deepEqual(await state(pending.e.org.id), before);
      const returned = await fresh(true);
      const path = `/api/hcm/effective-change-corrections?organizationId=${returned.e.org.id}&changeId=${returned.seeded.id}`;
      const own = await helper.standaloneRequest(path, { cookie: returned.e.cookie });
      assert.equal(own.status, 200); assert.equal(own.json.note, "Please correct the fictional effective date.");
      assert.equal(own.json.employeeId, returned.seeded.workerId);
      const malformed = await helper.standaloneRequest(path + "&organizationId=" + returned.e.org.id, { cookie: returned.e.cookie }); assert.equal(malformed.status, 400);
      await db.update(schema.userOrganizations).set({ role: "employee" }).where(and(eq(schema.userOrganizations.organizationId, returned.e.org.id), eq(schema.userOrganizations.userId, returned.e.owner.id)));
      const refused = await helper.standaloneRequest(path, { cookie: returned.e.cookie }); assert.equal(refused.status, 403);
      assert.ok(!refused.text.includes("Please correct"));
    });
    await t.test("maker, foreign source and unassigned reviewers cannot send back", async () => {
      const { e, seeded, input } = await fresh(false); const before = await state(e.org.id);
      const [maker] = await db.select().from(schema.users).where(eq(schema.users.id, seeded.makerId));
      await assert.rejects(sendBack({ ...input, userId: maker.id, name: maker.name, note: "Please correct the requested date." }), /Maker-checker/);
      await assert.rejects(sendBack({ ...input, organizationId: e.org.id + 100000, note: "Please correct the requested date." }), /not found/);
      await db.update(schema.hcmBusinessProcessInstanceSteps).set({ assignee: "Named independent reviewer" }).where(and(
        eq(schema.hcmBusinessProcessInstanceSteps.instanceId, seeded.processId), eq(schema.hcmBusinessProcessInstanceSteps.stepIndex, 0)));
      await assert.rejects(sendBack({ ...input, note: "Please correct the requested date." }), /assigned current/);
      const after = await state(e.org.id);
      assert.deepEqual(after.changes, before.changes); assert.deepEqual(after.audits, before.audits);
      assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.workers, before.workers);
    });
    await t.test("send-back atomically rolls back if its append-only audit cannot commit", async () => {
      const { e, input } = await fresh(false); const before = await state(e.org.id);
      await assert.rejects(sendBack({ ...input, name: "x".repeat(121), note: "Please correct the requested date." }));
      assert.deepEqual(await state(e.org.id), before);
    });
    await t.test("a corrupt foreign approval-task link cannot cancel another employer's work", async () => {
      const own = await fresh(false), victim = await fresh(false);
      const victimBefore = await state(victim.e.org.id);
      await db.update(schema.hcmBusinessProcessInstanceSteps).set({ approvalTaskId: victimBefore.tasks[0].id }).where(and(
        eq(schema.hcmBusinessProcessInstanceSteps.instanceId, own.seeded.processId), eq(schema.hcmBusinessProcessInstanceSteps.stepIndex, 0)));
      const ownBefore = await state(own.e.org.id);
      await assert.rejects(sendBack({ ...own.input, note: "Reject the corrupt foreign task link." }), /another employer/);
      assert.deepEqual(await state(victim.e.org.id), victimBefore);
      assert.deepEqual(await state(own.e.org.id), ownBefore);
    });
    await t.test("two simultaneous send-backs produce exactly one return and receipt", async () => {
      const { e, input } = await fresh(false);
      const results = await Promise.allSettled([sendBack({ ...input, note: "First correction request." }), sendBack({ ...input, note: "Second correction request." })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const after = await state(e.org.id);
      assert.equal(after.changes[0].status, "returned_for_correction");
      assert.equal(after.audits.filter(r => r.action === "HCM change returned for correction").length, 1);
      assert.ok(after.tasks.every(r => r.status === "Cancelled"));
    });
    await t.test("wrong requester, unchanged details and malformed dates cannot resubmit", async () => {
      const { e, seeded, input } = await fresh(true); const before = await state(e.org.id);
      const [other] = await db.select().from(schema.users).where(eq(schema.users.name, e.marker + " independent"));
      await assert.rejects(resubmit({ ...input, userId: other.id, name: other.name, reason: "Correct the source reason.", effectiveDate: "2099-01-02" }), /original requester/);
      await assert.rejects(resubmit({ ...input, reason: e.marker, effectiveDate: "2099-01-01" }), /Correct the reason/);
      for (const effectiveDate of ["2099-02-30", "2020-01-01", "2099-1-01", "0000-01-01"]) await assert.rejects(resubmit({ ...input, reason: "Correct the source reason.", effectiveDate }));
      assert.equal(seeded.makerId, e.owner.id); assert.deepEqual(await state(e.org.id), before);
    });
    await t.test("worker drift and tampered return receipt fail closed without a new process", async () => {
      const { e, seeded, input } = await fresh(true);
      await db.update(schema.employees).set({ title: "Changed after original request" }).where(eq(schema.employees.id, seeded.workerId));
      await assert.rejects(resubmit({ ...input, reason: "Correct the source reason.", effectiveDate: "2099-01-02" }), /Worker source changed/);
      assert.equal((await changes(e.org.id)).length, 1);
      const second = await fresh(true);
      await db.update(schema.workerEffectiveChanges).set({ toSnapshot: { changes: { employmentType: "Regular" } }, targetEmploymentType: "Regular" }).where(eq(schema.workerEffectiveChanges.id, second.seeded.id));
      await assert.rejects(resubmit({ ...second.input, reason: "Correct the source reason.", effectiveDate: "2099-01-02" }), /receipt cannot be verified/);
      assert.equal((await changes(second.e.org.id)).length, 1);
    });
    await t.test("concurrent resubmissions create one fresh approval run and preserve old history", async () => {
      const { e, seeded, input } = await fresh(true); const before = await state(e.org.id);
      const outcomes = await Promise.allSettled([resubmit({ ...input, reason: "Corrected requested date A.", effectiveDate: "2099-01-02" }), resubmit({ ...input, reason: "Corrected requested date B.", effectiveDate: "2099-01-03" })]);
      assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
      const after = await state(e.org.id), added = after.changes.find(r => r.id !== seeded.id);
      assert.ok(added); assert.equal(after.changes.length, 2); assert.equal(added.status, "pending_approval");
      assert.equal(added.approvedByUserId, null); assert.equal(added.appliedAt, null);
      assert.deepEqual(after.changes.find(r => r.id === seeded.id), before.changes[0]);
      assert.deepEqual(after.processes.filter(r => r.id === seeded.processId), before.processes);
      assert.deepEqual(after.steps.filter(r => r.instanceId === seeded.processId), before.steps);
      assert.deepEqual(after.tasks.filter(r => before.tasks.some(b => b.id === r.id)), before.tasks);
      assert.deepEqual(after.workers, before.workers); assert.deepEqual(after.events, before.events); assert.deepEqual(after.profiles, before.profiles);
      assert.equal(after.audits.filter(r => r.action === "HCM corrected change resubmitted").length, 1);
      const stale = await db.transaction(tx => advance(tx, { taskId: before.tasks[0].id, decision: "Approved", actorUserId: e.owner.id, actorName: e.owner.name }));
      assert.equal(stale.status, "cancelled"); assert.equal((await changes(e.org.id)).find(r => r.id === added.id).status, "pending_approval");
    });
    await t.test("a final approval racing a send-back cannot authorize both outcomes", async () => {
      const { e, seeded, input } = await fresh(false);
      const [first] = await db.select().from(schema.hcmBusinessProcessInstanceSteps).where(and(eq(schema.hcmBusinessProcessInstanceSteps.instanceId, seeded.processId), eq(schema.hcmBusinessProcessInstanceSteps.stepIndex, 0)));
      await db.transaction(tx => advance(tx, { taskId: first.approvalTaskId, decision: "Approved", actorUserId: e.owner.id, actorName: e.owner.name }));
      const [last] = await db.select().from(schema.hcmBusinessProcessInstanceSteps).where(and(eq(schema.hcmBusinessProcessInstanceSteps.instanceId, seeded.processId), eq(schema.hcmBusinessProcessInstanceSteps.stepIndex, 1)));
      await Promise.allSettled([sendBack({ ...input, note: "Correct before the final approval." }), db.transaction(tx => advance(tx, { taskId: last.approvalTaskId, decision: "Approved", actorUserId: e.owner.id, actorName: e.owner.name }))]);
      const after = await state(e.org.id), process = after.processes[0], source = after.changes[0];
      assert.ok(["approved", "cancelled"].includes(process.status));
      assert.equal(source.status, process.status === "cancelled" ? "returned_for_correction" : "pending_approval");
      assert.equal(source.appliedAt, null); assert.equal(after.events.length, 0);
      assert.equal(after.steps.find(r => r.stepIndex === 0).status, "completed");
    });
  } finally { await pool.end(); }
});
