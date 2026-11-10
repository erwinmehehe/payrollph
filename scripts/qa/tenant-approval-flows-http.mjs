/**
 * Dedicated PATCH /api/approvals/[id] proof for the FLOW-bound approval families the generic-task and leave/chain proofs
 * never reach: HCM business-process steps, workforce staffing-scenario approvals, governed roster-claim handoffs and the
 * automation approval gate. (Payroll-run approvals are proven by the money-lifecycle proof.)
 *
 * Three real fictional employers (two attackers, one higher-ID victim) on disposable PG16 behind production-mode localhost
 * HTTP. Each attacker proves its OWN decisions in every family, and these refusals: the victim's task IDs (404), and an own
 * task whose HCM process names the victim's worker, whose scenario chain names the victim's scenario, or whose handoff
 * evidence names the victim's real roster claim (all 409). Every employer's approval, HCM, workforce, roster, automation,
 * leave, payroll and audit rows are compared before and after. Fictional data only; no provider, worker or payout is enabled.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  APPROVAL_FLOWS_METHOD, APPROVAL_FLOWS_TITLE, assertApprovalDenial, assertOwnFlowDecision,
  assertSnapshotsUnchanged, requireDisposableApprovalFlows,
} from "./tenant-approval-flows-contract.mjs";

export async function verifyApprovalFlowsTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableApprovalFlows();
  const [{ db, pool }, schema, { and, eq }, fixture, chains, hcm, handoffs] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/approval-chains.ts"),
    import("../../src/lib/hcm-business-process.ts"),
    import("../../src/lib/governed-approval-handoffs.ts"),
  ]);
  const {
    approvalChainInstances, approvalChainPolicies, approvalTasks, automationExecutions, automationRules, auditEvents,
    hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps, openShiftClaims, openShifts, shiftDefinitions, sessions,
    userOrganizations, users, workforcePlanningScenarios, worksites,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;

  try {
    for (const [name, table] of [["organizations", schema.organizations], ["approval_tasks", approvalTasks],
      ["hcm_business_process_instances", hcmBusinessProcessInstances], ["workforce_planning_scenarios", workforcePlanningScenarios]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "APPROVAL_FLOWS_PROOF_REFUSED: genuinely empty disposable " + name + " required");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);

    async function makeActor(employer, label, role) {
      const [user] = await db.insert(users).values({
        email: "approval-flow-" + label + "-" + employer.marker.toLowerCase() + "@example.invalid",
        name: employer.marker + " " + label, passwordHash: "fictional-session-only", role, totpEnabled: true, active: true,
      }).returning();
      await db.insert(userOrganizations).values({ userId: user.id, organizationId: employer.org.id, role, active: true });
      const session = await standaloneMakeSession(user.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    // The employer owner INITIATES every flow (maker); a second owner and an HR member are the independent checkers.
    const actors = new Map();
    async function crew(employer) {
      const entry = { hr: await makeActor(employer, "hr", "hr"), checker: await makeActor(employer, "checker", "owner") };
      actors.set(employer.org.id, entry);
      return entry;
    }
    await crew(a); await crew(b);

    const policyFor = {};
    async function policy(employer) {
      if (policyFor[employer.org.id]) return policyFor[employer.org.id];
      const [row] = await db.insert(approvalChainPolicies).values({
        organizationId: employer.org.id, code: "fictional-one-step", name: "Fictional one-step", purpose: "automation",
        version: 1, active: true, steps: [{ label: "Owner review", approver: "role:owner", dueLabel: "Fictional" }],
      }).returning();
      return (policyFor[employer.org.id] = row);
    }
    const sha = (text) => createHash("sha256").update(text).digest("hex");
    const row = async (table, idColumn, id) => (await db.select().from(table).where(eq(idColumn, id)))[0];

    async function hcmProcess(employer, tag, employeeId) {
      const instance = await db.transaction((tx) => hcm.startHcmBusinessProcessTx(tx, {
        organizationId: employer.org.id, processType: "change_job", sourceType: "fictional_source",
        sourceKey: employer.marker + "-hcm-" + tag, employeeId, employeeLabel: employer.marker + " fictional worker",
        supervisoryOrgUnitId: null, effectiveDate: "2026-12-20", initiatedByUserId: employer.owner.id,
        initiatedByName: employer.owner.name,
      }));
      const steps = await db.select().from(hcmBusinessProcessInstanceSteps)
        .where(eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id));
      const first = steps.find((s) => s.stepIndex === 0);
      assert.ok(first && first.status === "pending" && Number.isInteger(first.approvalTaskId), "step 0 must be a real pending approval");
      assert.equal(steps.length, 2, "the default process has two steps");
      const [task] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, first.approvalTaskId));
      assert.equal(task.organizationId, employer.org.id);
      return { instance, task };
    }

    async function scenarioFlow(employer, tag, scenarioKeyOverride) {
      await policy(employer);
      const [scenario] = await db.insert(workforcePlanningScenarios).values({
        organizationId: employer.org.id, name: employer.marker + " scenario " + tag, version: 1,
        startDate: "2027-01-01", endDate: "2027-03-31", status: "submitted", snapshot: {},
        snapshotHash: sha(employer.marker + tag), createdByUserId: employer.owner.id,
        submittedByUserId: employer.owner.id, submittedAt: new Date(),
      }).returning();
      const started = await chains.createApprovalFromConfiguredChain({
        organizationId: employer.org.id, chainCode: "fictional-one-step", sourceType: "workforce_plan_scenario",
        sourceKey: String(scenarioKeyOverride ?? scenario.id), title: employer.marker + " scenario approval " + tag,
        detail: "Fictional staffing scenario; no payroll", fallbackApprover: "role:owner",
      });
      return { scenario, task: started.task, chainInstance: started.chainInstance };
    }

    async function claimFlow(employer, tag) {
      await policy(employer);
      let [worksite] = await db.select().from(worksites).where(eq(worksites.organizationId, employer.org.id)).limit(1);
      if (!worksite) [worksite] = await db.insert(worksites).values({
        organizationId: employer.org.id, code: "FW", name: employer.marker + " fictional site",
      }).returning();
      let [shift] = await db.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId, employer.org.id)).limit(1);
      if (!shift) [shift] = await db.insert(shiftDefinitions).values({
        organizationId: employer.org.id, code: "FD", name: employer.marker + " day", startTime: "08:00", endTime: "16:00",
      }).returning();
      const [openShift] = await db.insert(openShifts).values({
        organizationId: employer.org.id, worksiteId: worksite.id, workDate: "2027-01-12", shiftDefinitionId: shift.id,
        slots: 1, status: "open", reason: "Fictional coverage gap " + tag, createdBy: employer.owner.name,
        createdByUserId: employer.owner.id,
      }).returning();
      const [claim] = await db.insert(openShiftClaims).values({
        organizationId: employer.org.id, openShiftId: openShift.id, employeeId: employer.worker.id, status: "pending",
        reason: "Fictional claim " + tag, requestedBy: employer.owner.name, requestedByUserId: employer.owner.id,
      }).returning();
      return { claim, openShift };
    }
    // The loader's own fingerprint recipe, restated so a forged approval can carry the fingerprint the loader WOULD compute
    // if it read the victim's claim under the attacker's employer ID. It is checked against the real loader below, so drift
    // in the recipe fails the proof instead of silently weakening it.
    async function claimFingerprint(organizationId, claimId) {
      const claim = await row(openShiftClaims, openShiftClaims.id, claimId);
      const shift = await row(openShifts, openShifts.id, claim.openShiftId);
      const worker = await row(schema.employees, schema.employees.id, claim.employeeId);
      return handoffs.fingerprintGovernedHandoffSource({
        version: "wfm-claim-v1", organizationId, claimId: claim.id, claimStatus: claim.status,
        claimUpdatedAt: claim.updatedAt?.toISOString() ?? null, claimReason: claim.reason, employeeId: claim.employeeId,
        employeeStatus: worker.status, employeeOrgUnitId: worker.orgUnitId, openShiftId: shift.id, openShiftStatus: shift.status,
        openShiftUpdatedAt: shift.updatedAt?.toISOString() ?? null, worksiteId: shift.worksiteId, workDate: String(shift.workDate),
        shiftDefinitionId: shift.shiftDefinitionId, jobProfileId: shift.jobProfileId, slots: shift.slots,
      });
    }
    async function handoffApproval(employer, claimOwnerOrgId, claim, tag, employeeId) {
      const real = await handoffs.loadGovernedHandoffSource({
        organizationId: claimOwnerOrgId, sourceType: "wfm_roster_claim_review", sourceId: claim.id,
      });
      assert.ok(real?.eligible, "the roster claim must be a real eligible source");
      assert.equal(await claimFingerprint(claimOwnerOrgId, claim.id), real.sourceHash,
        "the restated fingerprint recipe must equal the real loader's");
      // For a forged approval the evidence is internally consistent for the ATTACKER's employer: only the loader's employer
      // filter stands between it and the victim's claim.
      const live = { ...real, sourceHash: await claimFingerprint(employer.org.id, claim.id) };
      const started = await chains.createApprovalFromConfiguredChain({
        organizationId: employer.org.id, chainCode: "fictional-one-step", sourceType: "wfm_roster_claim_review",
        sourceKey: handoffs.governedHandoffSourceKey(claim.id, live.sourceHash),
        title: employer.marker + " roster handoff " + tag, detail: "Fictional roster claim review; no payroll",
        fallbackApprover: "role:owner",
        sourceEvidence: {
          version: "governed-source-handoff-v1", sourceType: "wfm_roster_claim_review", sourceId: claim.id,
          sourceHash: live.sourceHash, initiatedByUserId: employer.owner.id, employeeId: employeeId ?? live.employeeId,
          orgUnitId: live.orgUnitId,
        },
      });
      return { task: started.task, chainInstance: started.chainInstance };
    }

    async function automationGate(employer, tag) {
      const [task] = await db.insert(approvalTasks).values({
        organizationId: employer.org.id, title: employer.marker + " automation gate " + tag,
        detail: "Fictional automation approval gate; no money", approver: "role:owner", dueLabel: "Fictional fixture", status: "Pending",
      }).returning();
      const [rule] = await db.insert(automationRules).values({
        organizationId: employer.org.id, name: employer.marker + " rule " + tag, trigger: "leave.approved",
        createdByUserId: employer.owner.id,
      }).returning();
      const [execution] = await db.insert(automationExecutions).values({
        organizationId: employer.org.id, ruleId: rule.id, employeeId: employer.worker.id, trigger: "leave.approved",
        eventKey: employer.marker + "-gate-" + tag, status: "waiting_approval", waitingApprovalTaskId: task.id,
        workflow: [], context: {}, cursor: 0, result: [],
      }).returning();
      return { task, execution };
    }

    async function bundle(employer, tag) {
      const hcmFlow = await hcmProcess(employer, tag, employer.worker.id);
      const scenario = await scenarioFlow(employer, tag);
      const claim = await claimFlow(employer, tag);
      const handoff = await handoffApproval(employer, employer.org.id, claim.claim, tag);
      const gate = await automationGate(employer, tag);
      return { hcmFlow, scenario, claim, handoff, gate };
    }
    const fa = await bundle(a, "main");
    const fb = await bundle(b, "main");
    // A filler employer consumes low IDs so every victim row ID exceeds both attackers' IDs and six.
    const filler = await seedEmployer("FILL", nonce, standaloneMakeSession);
    await crew(filler);
    for (let i = 0; i < 7; i++) await bundle(filler, "pad" + i);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    await crew(victim);
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id && victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    const fv = await bundle(victim, "target");
    const fvControl = await bundle(victim, "control");
    for (const [name, victimId, attackerMax] of [
      ["hcm task", fv.hcmFlow.task.id, Math.max(fa.hcmFlow.task.id, fb.hcmFlow.task.id, 6)],
      ["scenario task", fv.scenario.task.id, Math.max(fa.scenario.task.id, fb.scenario.task.id, 6)],
      ["scenario", fv.scenario.scenario.id, Math.max(fa.scenario.scenario.id, fb.scenario.scenario.id, 6)],
      ["handoff task", fv.handoff.task.id, Math.max(fa.handoff.task.id, fb.handoff.task.id, 6)],
      ["roster claim", fv.claim.claim.id, Math.max(fa.claim.claim.id, fb.claim.claim.id, 6)],
      ["gate task", fv.gate.task.id, Math.max(fa.gate.task.id, fb.gate.task.id, 6)],
      ["gate execution", fv.gate.execution.id, Math.max(fa.gate.execution.id, fb.gate.execution.id, 6)],
    ]) assert.ok(victimId > attackerMax, "victim " + name + " must be a real persisted row with an ID above both attackers and six");

    // Forged cross-employer pointers on the attackers' OWN approvals.
    const forgedHcm = {
      a: await hcmProcess(a, "forged", fv.hcmFlow.instance.employeeId),
      b: await hcmProcess(b, "forged", fv.hcmFlow.instance.employeeId),
    };
    const forgedScenario = {
      a: await scenarioFlow(a, "forged", fv.scenario.scenario.id),
      b: await scenarioFlow(b, "forged", fv.scenario.scenario.id),
    };
    // The forged scenario chain must name a scenario that does not exist in the attacker's employer.
    for (const [employer, flow] of [[a, forgedScenario.a], [b, forgedScenario.b]]) {
      await db.update(workforcePlanningScenarios).set({ status: "draft" }).where(eq(workforcePlanningScenarios.id, flow.scenario.id));
      assert.equal(flow.chainInstance.organizationId, employer.org.id);
    }
    const forgedHandoff = {
      a: await handoffApproval(a, victim.org.id, fv.claim.claim, "forged", fv.claim.claim.employeeId),
      b: await handoffApproval(b, victim.org.id, fv.claim.claim, "forged", fv.claim.claim.employeeId),
    };

    async function snapshot(orgId) {
      const tables = (await pool.query(`SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='organization_id'
        AND table_name ~ '^(approval|leave|payroll|audit|hcm|workforce|automation|employee|webhook|open|shift|worksite)' ORDER BY table_name`)).rows.map((r) => r.table_name);
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
    const denied = async (promise, status) => {
      const response = await promise;
      assertApprovalDenial(response, status, forbidden);
      return response;
    };
    const auditRows = async (orgId, action) => (await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)))
      .filter((event) => event.action === action);

    // Real victim-side HTTP successes (its own control rows) prove each family is reachable, not disabled.
    const vc = actors.get(victim.org.id);
    assertOwnFlowDecision(await decide(fvControl.hcmFlow.task, vc.hr.cookie, "Approved"),
      { id: fvControl.hcmFlow.task.id, organizationId: victim.org.id, status: "Approved", actor: vc.hr.user.name, hcm: true });
    assertOwnFlowDecision(await decide(fvControl.scenario.task, vc.checker.cookie, "Approved"),
      { id: fvControl.scenario.task.id, organizationId: victim.org.id, status: "Approved", actor: vc.checker.user.name, chain: true });
    assertOwnFlowDecision(await decide(fvControl.handoff.task, vc.checker.cookie, "Approved"),
      { id: fvControl.handoff.task.id, organizationId: victim.org.id, status: "Approved", actor: vc.checker.user.name, chain: true });
    assertOwnFlowDecision(await decide(fvControl.gate.task, vc.checker.cookie, "Declined"),
      { id: fvControl.gate.task.id, organizationId: victim.org.id, status: "Declined", actor: vc.checker.user.name, gate: true });
    assert.equal((await row(automationExecutions, automationExecutions.id, fvControl.gate.execution.id)).status, "failed");
    assert.equal((await row(automationExecutions, automationExecutions.id, fv.gate.execution.id)).status, "waiting_approval");

    const baseline = new Map(await Promise.all([a, b, victim].map(async (e) => [e.org.id, await snapshot(e.org.id)])));
    const checkAll = async (label) => {
      for (const employer of [a, b, victim]) {
        assertSnapshotsUnchanged(baseline.get(employer.org.id), await snapshot(employer.org.id), employer.label + " " + label);
      }
    };

    // Refusals. Every one must leak nothing and change no employer's persisted rows.
    for (const attacker of [a, b]) {
      const mine = actors.get(attacker.org.id);
      const key = attacker === a ? "a" : "b";
      for (const task of [fv.hcmFlow.task, fv.scenario.task, fv.handoff.task, fv.gate.task]) {
        for (const cookie of [attacker.cookie, mine.hr.cookie, mine.checker.cookie]) {
          await denied(decide(task, cookie, "Approved", { organizationId: attacker.org.id }), 404);
          await denied(decide(task, cookie, "Declined"), 404);
        }
      }
      // Own tasks whose source pointers name the victim: the employer-scoped source lookups find nothing and refuse.
      const refusedFor = async (promise, reason) => {
        const response = await denied(promise, 409);
        assert.ok(String(response.json?.error).includes(reason), "refused for the wrong reason: " + response.text.slice(0, 160));
      };
      await refusedFor(decide(forgedHcm[key].task, mine.hr.cookie, "Approved", { organizationId: victim.org.id }), "no longer has a valid employee");
      await refusedFor(decide(forgedScenario[key].task, mine.checker.cookie, "Approved"), "not linked to a valid staffing scenario");
      await refusedFor(decide(forgedScenario[key].task, mine.checker.cookie, "Declined"), "not linked to a valid staffing scenario");
      await refusedFor(decide(forgedHandoff[key].task, mine.checker.cookie, "Approved", { organizationId: victim.org.id }), "source changed after submission");
      await refusedFor(decide(forgedHandoff[key].task, mine.checker.cookie, "Declined"), "source changed after submission");
      for (const task of [forgedHcm[key].task, forgedScenario[key].task, forgedHandoff[key].task]) {
        assert.equal((await row(approvalTasks, approvalTasks.id, task.id)).status, "Pending");
      }
      // Maker-checker: the employer owner who initiated each own flow cannot decide it, and nothing is committed.
      const own = attacker === a ? fa : fb;
      const selfHcm = await denied(decide(own.hcmFlow.task, attacker.cookie, "Approved"), 403);
      assert.ok(selfHcm.json.error.includes("Maker-checker"), "HCM requester self-approval must name the maker-checker control");
      await denied(decide(own.scenario.task, attacker.cookie, "Approved"), 403);
      await denied(decide(own.handoff.task, attacker.cookie, "Approved"), 403);
    }
    await checkAll("after every refusal");

    // Own decisions. Untrusted body selectors that name the victim must be ignored.
    const forgedBody = (task) => ({
      organizationId: victim.org.id, taskId: task.id + 1000, approver: victim.owner.name,
      scenarioId: fv.scenario.scenario.id, instanceId: fv.hcmFlow.instance.id, claimId: fv.claim.claim.id,
    });
    for (const [employer, flows, tag] of [[a, fa, "A"], [b, fb, "B"]]) {
      const mine = actors.get(employer.org.id);
      const otherSnapshots = new Map();
      for (const other of [a, b, victim].filter((e) => e !== employer)) otherSnapshots.set(other, await snapshot(other.org.id));

      // HCM business process: two approval steps, decided by two different people (HR, then a second owner).
      const step1 = await decide(flows.hcmFlow.task, mine.hr.cookie, "Approved", forgedBody(flows.hcmFlow.task));
      assertOwnFlowDecision(step1, { id: flows.hcmFlow.task.id, organizationId: employer.org.id, status: "Approved", actor: mine.hr.user.name, hcm: true });
      assert.equal(step1.json.hcmBusinessProcess.final, false);
      assert.equal(step1.json.hcmBusinessProcess.instanceId, flows.hcmFlow.instance.id);
      assert.ok(!step1.text.includes(victim.marker), "forged HCM result leaked the victim marker");
      const nextId = step1.json.hcmBusinessProcess.nextTaskId;
      assert.ok(Number.isSafeInteger(nextId) && nextId > flows.hcmFlow.task.id, "the real next step task is created");
      const nextTask = await row(approvalTasks, approvalTasks.id, nextId);
      assert.equal(nextTask.organizationId, employer.org.id, "the next HCM step belongs to the deciding employer");
      if (tag === "A") {
        const step2 = await decide(nextTask, mine.checker.cookie, "Approved");
        assertOwnFlowDecision(step2, { id: nextTask.id, organizationId: employer.org.id, status: "Approved", actor: mine.checker.user.name, hcm: true });
        assert.equal(step2.json.hcmBusinessProcess.final, true);
        assert.equal(step2.json.hcmBusinessProcess.status, "approved");
        assert.equal((await row(hcmBusinessProcessInstances, hcmBusinessProcessInstances.id, flows.hcmFlow.instance.id)).status, "approved");
      } else {
        const step2 = await decide(nextTask, mine.checker.cookie, "Declined");
        assertOwnFlowDecision(step2, { id: nextTask.id, organizationId: employer.org.id, status: "Declined", actor: mine.checker.user.name, hcm: true });
        assert.equal(step2.json.hcmBusinessProcess.status, "declined");
        assert.equal((await row(hcmBusinessProcessInstances, hcmBusinessProcessInstances.id, flows.hcmFlow.instance.id)).status, "declined");
      }
      const victimInstance = await row(hcmBusinessProcessInstances, hcmBusinessProcessInstances.id, fv.hcmFlow.instance.id);
      assert.equal(victimInstance.status, "in_progress", "the victim process is untouched by this attacker's journey");

      // Workforce staffing scenario.
      const wf = await decide(flows.scenario.task, mine.checker.cookie, tag === "A" ? "Approved" : "Declined", forgedBody(flows.scenario.task));
      assertOwnFlowDecision(wf, { id: flows.scenario.task.id, organizationId: employer.org.id,
        status: tag === "A" ? "Approved" : "Declined", actor: mine.checker.user.name, chain: true });
      assert.deepEqual(wf.json.workforcePlanDecision, { scenarioId: flows.scenario.scenario.id, status: tag === "A" ? "approved" : "rejected" });
      const savedScenario = await row(workforcePlanningScenarios, workforcePlanningScenarios.id, flows.scenario.scenario.id);
      assert.equal(savedScenario.status, tag === "A" ? "approved" : "rejected");
      assert.equal(savedScenario.decidedByUserId, mine.checker.user.id);
      assert.equal((await row(workforcePlanningScenarios, workforcePlanningScenarios.id, fv.scenario.scenario.id)).status, "submitted");
      assert.equal((await auditRows(employer.org.id, tag === "A" ? "Workforce staffing scenario approved" : "Workforce staffing scenario rejected"))
        .filter((e) => e.metadata?.scenarioId === flows.scenario.scenario.id).length, 1);

      // Governed roster-claim handoff: a real eligible claim, decided by someone other than the initiator.
      const ho = await decide(flows.handoff.task, mine.checker.cookie, tag === "A" ? "Approved" : "Declined", forgedBody(flows.handoff.task));
      assertOwnFlowDecision(ho, { id: flows.handoff.task.id, organizationId: employer.org.id,
        status: tag === "A" ? "Approved" : "Declined", actor: mine.checker.user.name, chain: true });
      assert.equal((await row(openShiftClaims, openShiftClaims.id, fv.claim.claim.id)).status, "pending", "the victim roster claim is untouched");

      // Automation approval gate: the engine resumes ONLY the deciding employer's own waiting execution.
      const gate = await decide(flows.gate.task, mine.checker.cookie, "Declined", forgedBody(flows.gate.task));
      assertOwnFlowDecision(gate, { id: flows.gate.task.id, organizationId: employer.org.id, status: "Declined", actor: mine.checker.user.name, gate: true });
      const savedGate = await row(automationExecutions, automationExecutions.id, flows.gate.execution.id);
      assert.equal(savedGate.status, "failed");
      assert.equal(savedGate.organizationId, employer.org.id);
      assert.equal(savedGate.waitingApprovalTaskId, null);
      assert.equal((await row(automationExecutions, automationExecutions.id, fv.gate.execution.id)).status, "waiting_approval");

      // The OTHER employers' rows are byte-identical to before this employer's journey (the victim's control decisions were
      // taken before the baseline).
      for (const [other, snap] of otherSnapshots) {
        assertSnapshotsUnchanged(snap, await snapshot(other.org.id), other.label + " after " + employer.label + " journey");
      }
      // Chain: remember this employer's post-journey state so the later victim-unchanged comparison is exact.
      baseline.set(employer.org.id, await snapshot(employer.org.id));
    }

    // Replays are conflicts and change nothing.
    const afterDecisions = new Map(await Promise.all([a, b].map(async (e) => [e.org.id, await snapshot(e.org.id)])));
    await denied(decide(fa.scenario.task, actors.get(a.org.id).checker.cookie, "Approved"), 409);
    await denied(decide(fb.scenario.task, actors.get(b.org.id).checker.cookie, "Declined"), 409);
    await denied(decide(fa.handoff.task, actors.get(a.org.id).checker.cookie, "Approved"), 409);
    await denied(decide(fa.gate.task, actors.get(a.org.id).checker.cookie, "Declined"), 409);
    await denied(decide(fa.hcmFlow.task, actors.get(a.org.id).hr.cookie, "Approved"), 409);
    for (const employer of [a, b]) {
      assertSnapshotsUnchanged(afterDecisions.get(employer.org.id), await snapshot(employer.org.id), employer.label + " replay");
    }
    // The victim is byte-identical to the moment after its own control decisions, after every attacker request and decision.
    const victimNow = await snapshot(victim.org.id);
    assertSnapshotsUnchanged(baseline.get(victim.org.id), victimNow, "victim after both complete attacker journeys");

    console.log(JSON.stringify({
      kind: APPROVAL_FLOWS_TITLE, method: APPROVAL_FLOWS_METHOD, independentAttackers: 2, employers: 3, higherIdVictim: true,
      families: ["HCM business process two-step approve/decline", "workforce staffing scenario approve/reject",
        "governed roster-claim handoff approve/decline", "automation approval gate resume"],
      refusals: ["victim task of every family 404 for owner, HR and second owner", "HCM process naming a victim worker 409",
        "scenario chain naming a victim scenario 409", "handoff evidence naming the victim's real roster claim 409",
        "initiator self-approval 403", "replay 409"],
      victimOwnPositive: true, fullSnapshotsUnchanged: true, productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { method: APPROVAL_FLOWS_METHOD, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-approval-flows-http.mjs")) {
  verifyApprovalFlowsTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.message : "Approval flows isolation proof failed");
    process.exitCode = 1;
  });
}
