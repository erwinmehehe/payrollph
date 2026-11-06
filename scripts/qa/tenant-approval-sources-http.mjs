/**
 * Dedicated PATCH /api/approvals/[id] proof for SOURCE-BOUND approvals (leave and approval-chain steps).
 * The generic-task proof (tenant-approval-task-http.mjs) never advances a source; payroll is covered by the money lifecycle.
 *
 * Three real fictional employers (two attackers, one higher-ID victim) on disposable PG16 behind production-mode localhost
 * HTTP. Each attacker proves: own leave decision (approve / decline), own two-step chain advance and decline, requester
 * self-approval refusal, forged body selectors ignored; and refusals: the victim's leave and chain task IDs (404), an own
 * task whose payroll pointer names the victim's run (409) and an own task whose chain pointer names the victim's chain
 * instance (409). Every employer's approval, leave, chain, payroll, HCM, workforce, automation and audit rows are compared
 * before and after. Fictional data only; no provider, worker or payout is enabled.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  APPROVAL_SOURCES_METHOD, APPROVAL_SOURCES_TITLE, assertApprovalDenial, assertOwnSourceDecision,
  assertSnapshotsUnchanged, requireDisposableApprovalSources,
} from "./tenant-approval-sources-contract.mjs";

export async function verifyApprovalSourcesTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableApprovalSources();
  const [{ db, pool }, schema, { and, eq }, fixture, chains] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/approval-chains.ts"),
  ]);
  const {
    approvalChainInstances, approvalChainInstanceSteps, approvalChainPolicies, approvalTasks, auditEvents,
    leaveRequestIntervalSets, leaveRequests, payrollRuns, sessions, userOrganizations, users,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;

  try {
    for (const [name, table] of [["organizations", schema.organizations], ["approval_tasks", approvalTasks], ["leave_requests", leaveRequests]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "APPROVAL_SOURCES_PROOF_REFUSED: genuinely empty disposable " + name + " required");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id && victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);

    async function makeActor(employer, label, role) {
      const [user] = await db.insert(users).values({
        email: "approval-src-" + label + "-" + employer.marker.toLowerCase() + "@example.invalid",
        name: employer.marker + " " + label, passwordHash: "fictional-session-only", role, totpEnabled: true, active: true,
      }).returning();
      await db.insert(userOrganizations).values({ userId: user.id, organizationId: employer.org.id, role, active: true });
      const session = await standaloneMakeSession(user.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
      return { user, cookie: session.cookie };
    }

    const policyFor = {};
    async function policy(employer) {
      if (policyFor[employer.org.id]) return policyFor[employer.org.id];
      const [row] = await db.insert(approvalChainPolicies).values({
        organizationId: employer.org.id, code: "fictional-two-step", name: "Fictional two-step", purpose: "automation", version: 1, active: true,
        steps: [
          { label: "First owner review", approver: "role:owner", dueLabel: "Fictional" },
          { label: "Second owner review", approver: "role:owner", dueLabel: "Fictional" },
        ],
      }).returning();
      return (policyFor[employer.org.id] = row);
    }

    // One bundle of real source-bound approvals per employer: a leave decided by a different person than its requester, a leave
    // whose requester IS the employer owner (self-approval control) and a two-step approval-chain task created by the real library.
    async function bundle(employer, requester, tag) {
      await policy(employer);
      const leaveTask = async (suffix, days, startDate, endDate, requestedBy) => {
        const [task] = await db.insert(approvalTasks).values({
          organizationId: employer.org.id, title: employer.marker + " leave " + tag + " " + suffix,
          detail: "Fictional leave request; no payroll", approver: "role:owner", dueLabel: "Fictional fixture", status: "Pending",
        }).returning();
        const [leave] = await db.insert(leaveRequests).values({
          organizationId: employer.org.id, employeeId: employer.worker.id, leaveType: "Vacation", startDate, endDate,
          days, reason: "Fictional", status: "Pending", approvalTaskId: task.id,
        }).returning();
        const [set] = await db.insert(leaveRequestIntervalSets).values({
          organizationId: employer.org.id, leaveRequestId: leave.id, revision: 1, status: "current",
          createdByUserId: requestedBy.user.id, createdByName: requestedBy.user.name,
        }).returning();
        return { task, leave, set };
      };
      const ownLeave = await leaveTask("decide", "2.0", "2026-12-14", "2026-12-15", requester);
      const selfLeave = await leaveTask("self", "1.0", "2026-12-16", "2026-12-16", { user: employer.owner });
      const started = await chains.createApprovalFromConfiguredChain({
        organizationId: employer.org.id, chainCode: "fictional-two-step", sourceType: "fictional_source",
        sourceKey: employer.marker + "-" + tag, title: employer.marker + " chain " + tag,
        detail: "Fictional two-step approval; no payroll", fallbackApprover: "role:owner",
      });
      assert.equal(started.task.organizationId, employer.org.id);
      assert.equal(started.chainInstance.organizationId, employer.org.id);
      return { ownLeave, selfLeave, chainTask: started.task, chainInstance: started.chainInstance };
    }

    const reqA = await makeActor(a, "requester", "hr");
    const reqB = await makeActor(b, "requester", "hr");
    const reqV = await makeActor(victim, "requester", "hr");
    const fa = await bundle(a, reqA, "main");
    const fb = await bundle(b, reqB, "main");
    // A filler employer consumes low IDs, then the victim is created last: every victim task, leave and chain ID exceeds
    // both attackers' IDs and six, so no request can pass by echoing a small or shared identifier.
    const filler = await seedEmployer("FILL", nonce, standaloneMakeSession);
    const reqF = await makeActor(filler, "requester", "hr");
    for (let i = 0; i < 7; i++) {
      await bundle(filler, reqF, "pad" + i);
      await db.insert(payrollRuns).values({
        organizationId: filler.org.id, legalEntityId: filler.entity.id, periodLabel: filler.marker + " pad " + i,
        periodStart: "2026-11-01", periodEnd: "2026-11-15", payDate: "2026-11-16", status: "Draft",
      });
    }
    const fv = await bundle(victim, reqV, "target");
    const fvControl = await bundle(victim, reqV, "control");
    const [victimRun] = await db.insert(payrollRuns).values({
      organizationId: victim.org.id, legalEntityId: victim.entity.id, periodLabel: victim.marker + " pending approval run",
      periodStart: "2026-12-01", periodEnd: "2026-12-15", payDate: "2026-12-16", status: "Pending approval",
    }).returning();
    for (const [name, value] of [
      ["leave task", fv.ownLeave.task.id], ["self-leave task", fv.selfLeave.task.id], ["chain task", fv.chainTask.id],
      ["chain instance", fv.chainInstance.id], ["leave", fv.ownLeave.leave.id], ["payroll run", victimRun.id],
    ]) {
      const attackerMax = Math.max(
        { "leave task": fa.ownLeave.task.id, "self-leave task": fa.selfLeave.task.id, "chain task": fa.chainTask.id,
          "chain instance": fa.chainInstance.id, leave: fa.ownLeave.leave.id, "payroll run": 0 }[name],
        { "leave task": fb.ownLeave.task.id, "self-leave task": fb.selfLeave.task.id, "chain task": fb.chainTask.id,
          "chain instance": fb.chainInstance.id, leave: fb.ownLeave.leave.id, "payroll run": 0 }[name], 6);
      assert.ok(value > attackerMax, "victim " + name + " must be a real persisted row with an ID above both attackers and six");
    }

    // Forged cross-employer pointers on the attackers' OWN tasks.
    async function forged(employer, suffix, pointers) {
      const [task] = await db.insert(approvalTasks).values({
        organizationId: employer.org.id, title: employer.marker + " forged " + suffix,
        detail: "Fictional task with a forged pointer", approver: "role:owner", dueLabel: "Fictional fixture", status: "Pending", ...pointers,
      }).returning();
      return task;
    }
    const forgedPayroll = { a: await forged(a, "payroll pointer", { payrollRunId: victimRun.id }),
      b: await forged(b, "payroll pointer", { payrollRunId: victimRun.id }) };
    const forgedChain = { a: await forged(a, "chain pointer", { approvalChainInstanceId: fv.chainInstance.id, approvalChainStepIndex: 0 }),
      b: await forged(b, "chain pointer", { approvalChainInstanceId: fv.chainInstance.id, approvalChainStepIndex: 0 }) };

    async function snapshot(orgId) {
      const tables = (await pool.query(`SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='organization_id'
        AND table_name ~ '^(approval|leave|payroll|audit|hcm|workforce|automation|employee|webhook)' ORDER BY table_name`)).rows.map((r) => r.table_name);
      const state = { organizations: (await pool.query("SELECT to_jsonb(t) AS row FROM organizations t WHERE id=$1", [orgId])).rows };
      for (const name of tables) {
        assert.match(name, /^[a-z_]+$/);
        state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [orgId])).rows;
      }
      state.payroll_entries = (await pool.query(`SELECT to_jsonb(e) AS row FROM payroll_entries e JOIN payroll_runs r ON r.id=e.payroll_run_id
        WHERE r.organization_id=$1 ORDER BY e.id`, [orgId])).rows;
      return state;
    }
    const forbidden = [victim.marker, a.cookie.split("=")[1], b.cookie.split("=")[1], victim.cookie.split("=")[1]];
    const decide = (task, cookie, status, extra = {}) =>
      standaloneRequest("/api/approvals/" + task.id, { method: "PATCH", cookie, body: { status, ...extra } });
    const denied = async (promise, status, label) => {
      const response = await promise;
      assertApprovalDenial(response, status, forbidden);
      return response;
    };
    const row = async (table, idColumn, id) => (await db.select().from(table).where(eq(idColumn, id)))[0];
    const auditRows = async (orgId, action) => (await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)))
      .filter((event) => event.action === action);

    // Real victim-side HTTP success (its own control leave) proves the source-bound approval path is reachable, not disabled.
    const victimPositive = await decide(fvControl.ownLeave.task, victim.cookie, "Approved");
    assertOwnSourceDecision(victimPositive, {
      id: fvControl.ownLeave.task.id, organizationId: victim.org.id, status: "Approved", actor: victim.owner.name, leave: true,
    });
    assert.equal((await row(leaveRequests, leaveRequests.id, fvControl.ownLeave.leave.id)).status, "Approved");
    const baseline = new Map(await Promise.all([a, b, victim].map(async (e) => [e.org.id, await snapshot(e.org.id)])));
    for (const [id, status] of [[fv.ownLeave.leave.id, "Pending"], [fv.selfLeave.leave.id, "Pending"]]) {
      assert.equal((await row(leaveRequests, leaveRequests.id, id)).status, status, "victim attacked leave starts Pending");
    }
    assert.equal(baseline.get(victim.org.id).approval_chain_instances.length, 2, "victim holds its two real chain instances");

    const checkAll = async (label) => {
      for (const employer of [a, b, victim]) {
        assertSnapshotsUnchanged(baseline.get(employer.org.id), await snapshot(employer.org.id), employer.label + " " + label);
      }
    };

    // Refusals. Every one must leak nothing and change no employer's persisted rows.
    for (const attacker of [a, b]) {
      const cookie = attacker.cookie;
      for (const [task, label] of [
        [fv.ownLeave.task, "victim leave task"], [fv.selfLeave.task, "victim self-leave task"], [fv.chainTask, "victim chain task"],
      ]) {
        await denied(decide(task, cookie, "Approved", { organizationId: attacker.org.id }), 404, label + " with forged own organization");
        await denied(decide(task, cookie, "Declined"), 404, label);
      }
      await denied(decide(forgedPayroll[attacker === a ? "a" : "b"], cookie, "Approved", { organizationId: victim.org.id }), 409,
        "own task whose payroll pointer names the victim run");
      await denied(decide(forgedChain[attacker === a ? "a" : "b"], cookie, "Approved"), 409,
        "own task whose chain pointer names the victim chain instance");
      await denied(decide(forgedChain[attacker === a ? "a" : "b"], cookie, "Declined"), 409,
        "own task whose chain pointer names the victim chain instance (decline)");
      // Both forged own tasks stay pending: the refusals happened before any write.
      for (const task of [forgedPayroll, forgedChain]) {
        assert.equal((await row(approvalTasks, approvalTasks.id, task[attacker === a ? "a" : "b"].id)).status, "Pending");
      }
    }
    // The employer owner who made the leave request cannot approve it (maker-checker), and nothing is committed.
    for (const [employer, bundleOwn] of [[a, fa], [b, fb]]) {
      const refusal = await denied(decide(bundleOwn.selfLeave.task, employer.cookie, "Approved"), 403, "requester self-approval");
      assert.equal(refusal.json.code, "LEAVE_SELF_APPROVAL");
    }
    await checkAll("after every refusal");

    // Own decisions. Untrusted body selectors that name the victim must be ignored.
    const forgedBody = (task) => ({ organizationId: victim.org.id, taskId: task.id + 1000, approver: victim.owner.name, leaveId: fv.ownLeave.leave.id });
    const beforeB = await snapshot(b.org.id);
    const leaveA = await decide(fa.ownLeave.task, a.cookie, "Approved", forgedBody(fa.ownLeave.task));
    assertOwnSourceDecision(leaveA, { id: fa.ownLeave.task.id, organizationId: a.org.id, status: "Approved", actor: a.owner.name, leave: true });
    assert.ok(!leaveA.text.includes(victim.marker), "forged own leave result leaked the victim marker");
    const savedLeaveA = await row(leaveRequests, leaveRequests.id, fa.ownLeave.leave.id);
    assert.equal(savedLeaveA.status, "Approved");
    assert.equal(savedLeaveA.decidedBy, a.owner.name);
    assert.equal(savedLeaveA.organizationId, a.org.id);
    const leaveAudit = (await auditRows(a.org.id, "Leave independently approved")).filter((e) => e.metadata?.leaveId === fa.ownLeave.leave.id);
    assert.equal(leaveAudit.length, 1, "exactly one leave audit for the own leave");
    assert.equal(leaveAudit[0].metadata.approvalTaskId, fa.ownLeave.task.id);
    assert.equal(leaveAudit[0].metadata.deciderUserId, a.owner.id);
    assert.equal((await row(leaveRequests, leaveRequests.id, fv.ownLeave.leave.id)).status, "Pending", "victim leave untouched by attacker A");
    assertSnapshotsUnchanged(beforeB, await snapshot(b.org.id), "attacker B after attacker A's leave decision");

    const beforeA = await snapshot(a.org.id);
    const leaveB = await decide(fb.ownLeave.task, b.cookie, "Declined");
    assertOwnSourceDecision(leaveB, { id: fb.ownLeave.task.id, organizationId: b.org.id, status: "Declined", actor: b.owner.name, leave: true });
    assert.throws(() => assertOwnSourceDecision(leaveA, { id: fb.ownLeave.task.id, organizationId: b.org.id, status: "Declined", actor: b.owner.name, leave: true }),
      "A's real HTTP result must fail B's own-object proof");
    const savedLeaveB = await row(leaveRequests, leaveRequests.id, fb.ownLeave.leave.id);
    assert.equal(savedLeaveB.status, "Declined");
    assert.equal(savedLeaveB.decidedBy, b.owner.name);
    assert.equal((await auditRows(b.org.id, "Leave declined")).filter((e) => e.metadata?.leaveId === fb.ownLeave.leave.id).length, 1);
    assertSnapshotsUnchanged(beforeA, await snapshot(a.org.id), "attacker A after attacker B's leave decision");

    // Approval chain: A approves both steps (a real second task is created inside A), B declines the first step.
    const stepA1 = await decide(fa.chainTask, a.cookie, "Approved", forgedBody(fa.chainTask));
    assertOwnSourceDecision(stepA1, { id: fa.chainTask.id, organizationId: a.org.id, status: "Approved", actor: a.owner.name, chain: true });
    assert.equal(stepA1.json.approvalChain.final, false, "first of two steps is not final");
    assert.equal(stepA1.json.approvalChain.instanceId, fa.chainInstance.id);
    const nextId = stepA1.json.approvalChain.nextTaskId;
    assert.ok(Number.isSafeInteger(nextId) && nextId > fa.chainTask.id, "a real next step task is created");
    const nextTask = await row(approvalTasks, approvalTasks.id, nextId);
    assert.equal(nextTask.organizationId, a.org.id, "the next chain step belongs to the deciding employer");
    assert.equal(nextTask.approvalChainInstanceId, fa.chainInstance.id);
    assert.equal(nextTask.approvalChainStepIndex, 1);
    const stepA2 = await decide(nextTask, a.cookie, "Approved");
    assertOwnSourceDecision(stepA2, { id: nextTask.id, organizationId: a.org.id, status: "Approved", actor: a.owner.name, chain: true });
    assert.equal(stepA2.json.approvalChain.final, true);
    assert.equal(stepA2.json.approvalChain.status, "approved");
    assert.equal((await row(approvalChainInstances, approvalChainInstances.id, fa.chainInstance.id)).status, "approved");
    const aSteps = await db.select().from(approvalChainInstanceSteps).where(eq(approvalChainInstanceSteps.instanceId, fa.chainInstance.id));
    assert.deepEqual(aSteps.map((s) => [s.stepIndex, s.status, s.organizationId]).sort(), [[0, "approved", a.org.id], [1, "approved", a.org.id]]);

    const stepB1 = await decide(fb.chainTask, b.cookie, "Declined");
    assertOwnSourceDecision(stepB1, { id: fb.chainTask.id, organizationId: b.org.id, status: "Declined", actor: b.owner.name, chain: true });
    assert.equal(stepB1.json.approvalChain.final, true);
    assert.equal(stepB1.json.approvalChain.status, "declined");
    assert.equal(stepB1.json.approvalChain.nextTaskId, null);
    assert.equal((await row(approvalChainInstances, approvalChainInstances.id, fb.chainInstance.id)).status, "declined");
    assert.equal((await db.select().from(approvalTasks).where(and(eq(approvalTasks.organizationId, b.org.id), eq(approvalTasks.approvalChainInstanceId, fb.chainInstance.id)))).length, 1,
      "a declined chain creates no further step");

    // Replays are conflicts and change nothing.
    const afterDecisions = new Map(await Promise.all([a, b].map(async (e) => [e.org.id, await snapshot(e.org.id)])));
    await denied(decide(fa.ownLeave.task, a.cookie, "Approved"), 409, "leave replay");
    await denied(decide(fb.ownLeave.task, b.cookie, "Declined"), 409, "leave replay");
    await denied(decide(fa.chainTask, a.cookie, "Approved"), 409, "chain replay");
    await denied(decide(fb.chainTask, b.cookie, "Declined"), 409, "chain replay");
    for (const employer of [a, b]) {
      assertSnapshotsUnchanged(afterDecisions.get(employer.org.id), await snapshot(employer.org.id), employer.label + " replay");
    }
    // The victim is byte-identical to the moment after its own control decision, after every attacker request and decision.
    assertSnapshotsUnchanged(baseline.get(victim.org.id), await snapshot(victim.org.id), "victim after both complete attacker journeys");

    console.log(JSON.stringify({
      kind: APPROVAL_SOURCES_TITLE, method: APPROVAL_SOURCES_METHOD, independentAttackers: 2, employers: 3, higherIdVictim: true,
      sources: ["leave approve", "leave decline", "chain two-step approve", "chain decline"],
      refusals: ["victim leave task 404", "victim chain task 404", "forged payroll pointer 409", "forged chain pointer 409", "requester self-approval 403", "replay 409"],
      victimOwnPositive: true, fullSnapshotsUnchanged: true, productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { method: APPROVAL_SOURCES_METHOD, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-approval-sources-http.mjs")) {
  verifyApprovalSourcesTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Approval sources isolation proof failed");
    process.exitCode = 1;
  });
}
