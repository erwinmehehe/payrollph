/** Missing approval source families. Fictional disposable PG16 and real localhost HTTP only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { requireApprovalTypesTarget, assertTypedDecision } from './tenant-approval-types-contract.mjs';

export async function proveApprovalTypes() {
  requireApprovalTypesTarget(); // Before any application/database import.
  const [{ db, pool }, s, { and, eq }, f, chains, hcm, handoffs, automationEngine, positionEvidence] = await Promise.all([
    import('../../src/db/index.ts'), import('../../src/db/schema.ts'), import('drizzle-orm'),
    import('./tenant-table-http.mjs'), import('../../src/lib/approval-chains.ts'),
    import('../../src/lib/hcm-business-process.ts'), import('../../src/lib/governed-approval-handoffs.ts'), import('../../src/lib/automation.ts'),
    import('../../src/lib/hcm-position-business-process.ts'),
  ]);
  const one = async (table, id) => (await db.select().from(table).where(eq(table.id, id)))[0];
  const patch = (employer, task, status, extra = {}) => f.standaloneRequest('/api/approvals/' + task.id,
    { method: 'PATCH', cookie: employer.cookie, body: { status, ...extra } });
  const verifyDecision = process.env.TENANT_APPROVAL_TYPES_MUTATION === 'noop'
    ? response => response.json : assertTypedDecision;
  try {
    const version = Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, 'Actual PostgreSQL 16 required');
    for (const table of [s.organizations, s.users, s.approvalTasks]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0, 'Fresh empty fixture database required');
    }
    const nonce = randomUUID().replaceAll('-', '').slice(0, 10);
    const a = await f.seedEmployer('APTA', nonce, f.standaloneMakeSession);
    const b = await f.seedEmployer('APTB', nonce, f.standaloneMakeSession);
    // Consume genuinely persisted employer/worker IDs before the victim, never guessed IDs.
    for (let i = 0; i < 7; i++) await f.seedEmployer('PAD' + i, nonce, f.standaloneMakeSession);
    const victim = await f.seedEmployer('APTV', nonce, f.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, 6));
    const employers = [a, b, victim];
    const definitions = [
      ['one', [{ label: 'Fictional checker', approver: 'role:owner' }]],
      ['two', [{ label: 'First checker', approver: 'role:owner' }, { label: 'Second checker', approver: 'role:owner' }]],
      ['group', [{ label: 'Live worker group', approver: 'role:owner', dynamicGroupCode: 'approval-owners' }]],
    ];
    async function makeBundle(e, suffix) {
      const [maker] = await db.insert(s.users).values({ email: e.marker + suffix + '@example.invalid',
        name: e.marker + ' maker ' + suffix, passwordHash: 'fictional-only', role: 'hr' }).returning();
      await db.insert(s.userOrganizations).values({ userId: maker.id, organizationId: e.org.id, role: 'hr', active: true });
      const [change] = await db.insert(s.workerEffectiveChanges).values({ organizationId: e.org.id,
        employeeId: e.worker.id, effectiveDate: '2099-12-01', reason: 'Fictional job change',
        requestedByUserId: maker.id, requestedBy: maker.name }).returning();
      const process = await db.transaction(tx => hcm.startHcmBusinessProcessTx(tx, {
        organizationId: e.org.id, processType: 'change_job', sourceType: 'worker_effective_change',
        sourceKey: String(change.id), employeeId: e.worker.id, employeeLabel: e.marker,
        effectiveDate: '2099-12-01', initiatedByUserId: maker.id, initiatedByName: maker.name,
      }));
      const [step] = await db.select().from(s.hcmBusinessProcessInstanceSteps).where(and(
        eq(s.hcmBusinessProcessInstanceSteps.instanceId, process.id), eq(s.hcmBusinessProcessInstanceSteps.stepIndex, 0)));
      const hcmTask = await one(s.approvalTasks, step.approvalTaskId);
      async function startVariant(processType, sourceType, sourceKey, sourceEvidence, employeeId = null) {
        const instance = await db.transaction(tx => hcm.startHcmBusinessProcessTx(tx, {
          organizationId: e.org.id, processType, sourceType, sourceKey, sourceEvidence, employeeId,
          employeeLabel: e.marker, effectiveDate: '2099-12-01',
          initiatedByUserId: maker.id, initiatedByName: maker.name,
        }));
        const [linked] = await db.select().from(s.hcmBusinessProcessInstanceSteps).where(and(
          eq(s.hcmBusinessProcessInstanceSteps.instanceId, instance.id), eq(s.hcmBusinessProcessInstanceSteps.stepIndex, 0)));
        return { instance, task: await one(s.approvalTasks, linked.approvalTaskId) };
      }
      const [profile] = await db.insert(s.jobProfiles).values({ organizationId: e.org.id, title: e.marker + suffix }).returning();
      const positionVariants = {};
      for (const [kind, processType, sourceType, initial] of [
        ['positionCreate', 'create_position', 'position_creation', 'planned'],
        ['positionClose', 'close_position', 'position_closure', 'approved'],
      ]) {
        const [position] = await db.insert(s.positions).values({ organizationId: e.org.id,
          code: e.marker + suffix + kind, jobProfileId: profile.id, legalEntityId: e.entity.id, status: initial }).returning();
        const frozen = positionEvidence.freezeHcmPositionSource(position);
        positionVariants[kind] = { position, ...await startVariant(processType, sourceType,
          position.id + ':' + frozen.fingerprint, frozen) };
      }
      const [cycle] = await db.insert(s.compensationCycles).values({ organizationId: e.org.id,
        name: e.marker + suffix, startDate: '2099-11-01', endDate: '2099-11-30', effectiveDate: '2099-12-01' }).returning();
      const [band] = await db.insert(s.compensationBands).values({ organizationId: e.org.id,
        jobProfileId: profile.id, minimumAnnual: '100', midpointAnnual: '200', maximumAnnual: '300', effectiveFrom: '2099-01-01' }).returning();
      const [proposal] = await db.insert(s.compensationProposals).values({ organizationId: e.org.id,
        cycleId: cycle.id, employeeId: e.worker.id, bandId: band.id, currentAnnual: '200', proposedAnnual: '220',
        reason: 'Fictional recommendation; no salary application', submittedByUserId: maker.id }).returning();
      const compensation = { proposal, ...await startVariant('compensation_change', 'compensation_proposal',
        String(proposal.id), undefined, e.worker.id) };
      const [plan] = await db.insert(s.workforcePlans).values({ organizationId: e.org.id,
        name: e.marker + suffix, startDate: '2099-12-01', endDate: '2099-12-31', status: 'submitted' }).returning();
      const [scenario] = await db.insert(s.workforcePlanningScenarios).values({ organizationId: e.org.id,
        planId: plan.id, name: e.marker + suffix, startDate: '2099-12-01', endDate: '2099-12-31',
        status: 'submitted', snapshotHash: 'a'.repeat(64), createdByUserId: maker.id,
        submittedByUserId: maker.id }).returning();
      const chain = (code, sourceType, sourceKey, sourceEvidence) => chains.createApprovalFromConfiguredChain({
        organizationId: e.org.id, chainCode: code, sourceType, sourceKey,
        title: e.marker + ' ' + sourceType + suffix, detail: 'Fictional source-bound approval',
        fallbackApprover: 'role:owner', sourceEvidence,
      });
      const workforce = await chain('one', 'workforce_plan_scenario', String(scenario.id));
      const [separation] = await db.insert(s.separationRecords).values({ organizationId: e.org.id,
        employeeId: e.worker.id, separationType: 'resignation', noticeDate: '2099-11-01',
        lastDay: '2099-12-31' }).returning();
      const source = await handoffs.loadGovernedHandoffSource({ organizationId: e.org.id,
        sourceType: 'hcm_separation_readiness', sourceId: separation.id });
      assert.equal(source?.eligible, true);
      const evidence = { version: 'governed-source-handoff-v1', sourceType: source.sourceType,
        sourceId: source.sourceId, sourceHash: source.sourceHash, initiatedByUserId: maker.id,
        employeeId: source.employeeId, orgUnitId: source.orgUnitId };
      const handoff = await chain('one', source.sourceType,
        handoffs.governedHandoffSourceKey(source.sourceId, source.sourceHash), evidence);
      const [site] = await db.insert(s.worksites).values({ organizationId: e.org.id,
        code: ('site-' + suffix).slice(0, 32), name: e.marker + suffix }).returning();
      const [shift] = await db.insert(s.shiftDefinitions).values({ organizationId: e.org.id,
        code: ('shift-' + suffix).slice(0, 32), name: 'Fictional shift', startTime: '09:00', endTime: '18:00' }).returning();
      const [openShift] = await db.insert(s.openShifts).values({ organizationId: e.org.id,
        worksiteId: site.id, shiftDefinitionId: shift.id, workDate: '2099-12-01' }).returning();
      const [claim] = await db.insert(s.openShiftClaims).values({ organizationId: e.org.id,
        openShiftId: openShift.id, employeeId: e.worker.id, requestedBy: maker.name,
        requestedByUserId: maker.id }).returning();
      const rosterSource = await handoffs.loadGovernedHandoffSource({ organizationId: e.org.id,
        sourceType: 'wfm_roster_claim_review', sourceId: claim.id });
      assert.equal(rosterSource?.eligible, true);
      const rosterEvidence = { ...evidence, sourceType: rosterSource.sourceType,
        sourceId: rosterSource.sourceId, sourceHash: rosterSource.sourceHash };
      const roster = await chain('one', rosterSource.sourceType,
        handoffs.governedHandoffSourceKey(rosterSource.sourceId, rosterSource.sourceHash), rosterEvidence);
      const dynamic = await chain('group', 'fictional_dynamic_review', e.marker + suffix);
      const [rule] = await db.insert(s.automationRules).values({ organizationId: e.org.id,
        name: e.marker + suffix, trigger: 'employee.hired', active: false }).returning();
      const [execution] = await db.insert(s.automationExecutions).values({ organizationId: e.org.id,
        ruleId: rule.id, employeeId: e.worker.id, trigger: 'employee.hired', eventKey: e.marker + suffix,
        status: 'in_progress', workflow: [{ type: 'approval_gate', title: e.marker + ' gate',
          detail: 'Fictional human approval gate', approver: 'role:owner', approvalChainCode: 'two' }],
        cursor: 0, context: {}, result: [] }).returning();
      const waiting = await automationEngine.advanceAutomationExecution(execution.id);
      assert.equal(waiting.status, 'waiting_approval');
      const automation = { task: await one(s.approvalTasks, waiting.waitingApprovalTaskId) };
      return { maker, change, process, step, hcmTask, plan, scenario, workforce, separation, handoff,
        roster, claim, openShift, dynamic, automation, execution, ...positionVariants, compensation };
    }
    // Own and foreign source fixtures use exactly the same definitions and real libraries.
    const bundles = new Map();
    for (const e of employers) {
      for (const [code, steps] of definitions) await db.insert(s.approvalChainPolicies).values({
        organizationId: e.org.id, code, name: 'Fictional ' + code, purpose: 'automation', steps });
      for (const processType of ['change_job', 'create_position', 'close_position', 'compensation_change']) {
        await db.insert(s.hcmBusinessProcessDefinitions).values({ organizationId: e.org.id,
          code: 'fictional-' + processType, name: 'Fictional HCM checker', processType,
          effectiveFrom: '2020-01-01', steps: [{ type: 'approval', label: 'Owner checker', assignee: 'role:owner', dueDays: 1 }] });
      }
      await db.update(s.userOrganizations).set({ workerEmployeeId: e.worker.id }).where(and(
        eq(s.userOrganizations.organizationId, e.org.id), eq(s.userOrganizations.userId, e.owner.id)));
      const [group] = await db.insert(s.dynamicWorkerGroups).values({ organizationId: e.org.id,
        code: 'approval-owners', name: 'Fictional active workers',
        conditions: { version: 1, all: [{ field: 'employeeStatus', operator: 'eq', value: 'Active' }], any: [] } }).returning();
      // Pad every source table with real instances; completed HCM records free the per-worker pending-change slot.
      if (e === victim) {
        for (let i = 0; i < 7; i++) {
          const pad = await makeBundle(e, 'pad' + i);
          await db.update(s.workerEffectiveChanges).set({ status: 'cancelled' }).where(eq(s.workerEffectiveChanges.id, pad.change.id));
        }
      }
      const bundle = await makeBundle(e, 'target');
      bundles.set(e.org.id, { ...bundle, group });
    }
    const v = bundles.get(victim.org.id);
    for (const e of [a, b]) for (const key of ['hcmTask', 'scenario', 'process', 'execution']) {
      assert.ok(v[key].id > Math.max(bundles.get(e.org.id)[key].id, 6), 'Real higher-ID victim ' + key);
    }
    for (const e of [a, b]) for (const kind of ['positionCreate', 'positionClose', 'compensation']) {
      const x = bundles.get(e.org.id)[kind], foreign = v[kind];
      for (const key of ['task', 'instance', kind === 'compensation' ? 'proposal' : 'position']) {
        assert.ok(foreign[key].id > Math.max(x[key].id, 6), 'Real higher-ID HCM victim ' + kind + ' ' + key);
      }
    }
    // The victim can really decide the same source families. Use separate live
    // control sources so the actual attacked tasks remain pending and eligible.
    const controlWorker = await f.addWorker(victim, 'CONTROL');
    const control = await makeBundle({ ...victim, worker: controlWorker }, 'control');
    let victimControlWrites = 0;
    for (const task of [control.hcmTask, control.workforce.task, control.handoff.task, control.roster.task,
      control.dynamic.task, control.positionCreate.task, control.positionClose.task,
      control.compensation.task, control.automation.task]) {
      const response = await patch(victim, task, 'Approved');
      const result = assertTypedDecision(response, { task, employer: victim, status: 'Approved' });
      assert.equal((await one(s.approvalTasks, task.id)).status, 'Approved');
      victimControlWrites++;
      if (task.id === control.automation.task.id) {
        const next = await one(s.approvalTasks, result.approvalChain.nextTaskId);
        assertTypedDecision(await patch(victim, next, 'Approved'), { task: next, employer: victim, status: 'Approved' });
        assert.equal((await one(s.automationExecutions, control.execution.id)).status, 'completed');
        victimControlWrites++;
      }
    }
    assert.equal(victimControlWrites, 10);
    assert.equal((await one(s.workerEffectiveChanges, control.change.id)).status, 'scheduled');
    assert.equal((await one(s.workforcePlanningScenarios, control.scenario.id)).status, 'approved');
    assert.equal((await one(s.positions, control.positionCreate.position.id)).status, 'approved');
    assert.equal((await one(s.positions, control.positionClose.position.id)).status, 'closed');
    const tables = (await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name")).rows.map(r => r.table_name);
    async function snapshot(e) {
      const data = {};
      const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      for (const table of tables) {
        assert.match(table, /^[a-z_]+$/);
        data[table] = digest((await pool.query('SELECT to_jsonb(t) AS row FROM "' + table + '" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text', [e.org.id])).rows);
      }
      data.payroll_entries = digest((await pool.query('SELECT to_jsonb(e) AS row FROM payroll_entries e JOIN payroll_runs r ON r.id=e.payroll_run_id WHERE r.organization_id=$1 ORDER BY e.id', [e.org.id])).rows);
      return data;
    }
    const before = new Map(await Promise.all(employers.map(async e => [e.org.id, await snapshot(e)])));
    async function unchanged(e, label) { assert.deepEqual(await snapshot(e), before.get(e.org.id), label + ': protected SQL changed'); }
    let ownWrites = 0, victimDenials = 0, sourceGuardDenials = 0, auditRollbacks = 0, discriminations = 0;
    const captured = new Map();
    async function refusedFixture(e, table, id, changes, task, expectedStatus) {
      const original = await one(table, id);
      await db.update(table).set(changes).where(eq(table.id, id));
      try {
        const saved = new Map(await Promise.all(employers.map(async subject => [subject.org.id, await snapshot(subject)])));
        const response = await patch(e, task, 'Approved');
        assert.equal(response.status, expectedStatus, 'source/maker/live-group boundary: ' + response.text?.slice(0, 200));
        for (const subject of employers) assert.deepEqual(await snapshot(subject), saved.get(subject.org.id), 'refused source changed SQL/audit');
        sourceGuardDenials++;
      } finally {
        await db.update(table).set(Object.fromEntries(Object.keys(changes).map(key => [key, original[key]]))).where(eq(table.id, id));
      }
    }
    for (const e of [a, b]) {
      const x = bundles.get(e.org.id), peer = e === a ? b : a;
      for (const task of [v.hcmTask, v.workforce.task, v.handoff.task, v.roster.task, v.dynamic.task, v.automation.task,
        v.positionCreate.task, v.positionClose.task, v.compensation.task]) {
        const denied = await patch(e, task, 'Approved', { organizationId: e.org.id });
        assert.equal(denied.status, 404);assert.deepEqual(denied.json, { error: 'Approval task not found.' });
        assert.ok(!(denied.text + JSON.stringify([...denied.headers])).includes(victim.marker), 'Foreign source marker leaked');
        await unchanged(victim, 'foreign task denied');await unchanged(e, 'denial did not mutate attacker');
        victimDenials++;
      }
      await refusedFixture(e, s.hcmBusinessProcessInstances, x.process.id,
        { employeeId: victim.worker.id }, x.hcmTask, 409);
      await refusedFixture(e, s.hcmBusinessProcessInstances, x.process.id,
        { initiatedByUserId: e.owner.id }, x.hcmTask, 403);
      await refusedFixture(e, s.workforcePlanningScenarios, x.scenario.id,
        { submittedByUserId: e.owner.id }, x.workforce.task, 403);
      await refusedFixture(e, s.approvalChainInstances, x.workforce.chainInstance.id,
        { sourceKey: String(v.scenario.id) }, x.workforce.task, 409);
      await refusedFixture(e, s.approvalChainInstances, x.handoff.chainInstance.id,
        { routingSnapshot: { ...x.handoff.chainInstance.routingSnapshot,
          sourceEvidence: { ...x.handoff.chainInstance.routingSnapshot.sourceEvidence, initiatedByUserId: e.owner.id } } }, x.handoff.task, 403);
      await refusedFixture(e, s.approvalChainInstances, x.handoff.chainInstance.id,
        { sourceKey: v.handoff.chainInstance.sourceKey, routingSnapshot: v.handoff.chainInstance.routingSnapshot }, x.handoff.task, 409);
      await refusedFixture(e, s.openShiftClaims, x.claim.id, { status: 'cancelled' }, x.roster.task, 409);
      await refusedFixture(e, s.approvalChainInstances, x.dynamic.chainInstance.id,
        { stepsSnapshot: x.dynamic.chainInstance.stepsSnapshot.map(step => ({ ...step, dynamicGroupId: v.group.id })) }, x.dynamic.task, 403);
      await refusedFixture(e, s.dynamicWorkerGroups, x.group.id, { version: x.group.version + 1 }, x.dynamic.task, 409);
      await refusedFixture(e, s.dynamicWorkerGroups, x.group.id,
        { conditions: { version: 1, all: [{ field: 'employeeStatus', operator: 'eq', value: 'Inactive' }], any: [] } }, x.dynamic.task, 403);
      for (const [task, kind] of [[x.hcmTask, 'hcm'], [x.workforce.task, 'workforce'],
        [x.handoff.task, 'handoff'], [x.roster.task, 'roster'], [x.dynamic.task, 'dynamic'], [x.automation.task, 'automation'],
        [x.positionCreate.task, 'positionCreate'], [x.positionClose.task, 'positionClose'], [x.compensation.task, 'compensation']]) {
        const status = e === a ? 'Approved' : 'Declined';
        // A genuine database audit failure must roll back the source and task,
        // not merely produce a pre-validation refusal. The next call proves this
        // same still-pending fixture can successfully commit once veto is removed.
        await pool.query(`CREATE FUNCTION qa_approval_types_veto() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.metadata->>'taskId' = '${task.id}' THEN RAISE EXCEPTION 'QA_TYPED_APPROVAL_AUDIT_VETO'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER qa_approval_types_veto BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_approval_types_veto()');
        try {
          const saved = new Map(await Promise.all(employers.map(async subject => [subject.org.id, await snapshot(subject)])));
          assert.equal((await patch(e, task, status)).status, 500, 'Injected audit failure must refuse the entire transaction');
          for (const subject of employers) assert.deepEqual(await snapshot(subject), saved.get(subject.org.id), 'audit veto changed SQL');
          auditRollbacks++;
        } finally {
          await pool.query('DROP TRIGGER qa_approval_types_veto ON audit_events');
          await pool.query('DROP FUNCTION qa_approval_types_veto()');
        }
        const response = await patch(e, task, status, { organizationId: victim.org.id,
          employeeId: victim.worker.id, sourceId: v.scenario.id, executionId: v.execution.id });
        if (e === b) {
          assert.throws(() => verifyDecision(captured.get(kind), { task, employer: e, status }),
            /accepts another employer's data/, "proof accepts another employer's data");
          discriminations++;
        } else captured.set(kind, response);
        const result = verifyDecision(response, { task, employer: e, status });
        for (const other of employers.filter(subject => subject !== e)) {
          assert.ok(!(response.text + JSON.stringify([...response.headers])).includes(other.marker), 'Own response leaked foreign source details');
        }
        assert.equal((await one(s.approvalTasks, task.id)).status, status);
        if (kind === 'positionCreate' || kind === 'positionClose') {
          assert.equal((await one(s.positions, x[kind].position.id)).status,
            status === 'Declined' ? x[kind].position.status : kind === 'positionCreate' ? 'approved' : 'closed');
          assert.equal((await one(s.hcmBusinessProcessInstances, x[kind].instance.id)).status,
            status === 'Declined' ? 'declined' : 'applied');
        } else if (kind === 'compensation') {
          assert.equal((await one(s.compensationProposals, x.compensation.proposal.id)).status,
            status === 'Approved' ? 'proposed' : 'declined', 'HCM cannot apply salary or bypass the separate pay approval');
          assert.ok(!result.hcmBusinessProcessSource?.error, 'No HCM source finalization error');
        } else if (kind === 'hcm') {
          assert.equal(result.hcmBusinessProcess.instanceId, x.process.id);
          assert.equal((await one(s.hcmBusinessProcessInstances, x.process.id)).status, status === 'Approved' ? 'approved' : 'declined');
          assert.equal((await one(s.workerEffectiveChanges, x.change.id)).status, status === 'Approved' ? 'scheduled' : 'declined');
        } else if (kind === 'workforce') {
          assert.equal((await one(s.workforcePlanningScenarios, x.scenario.id)).status, status === 'Approved' ? 'approved' : 'rejected');
          assert.equal((await one(s.workforcePlans, x.plan.id)).status, status === 'Approved' ? 'approved' : 'rejected');
        } else if (kind === 'handoff') {
          assert.equal((await one(s.separationRecords, x.separation.id)).status, 'draft', 'Handoff never approves final pay');
        } else if (kind === 'roster') {
          assert.equal((await one(s.openShiftClaims, x.claim.id)).status, 'pending', 'Handoff never assigns the roster');
          assert.equal((await one(s.openShifts, x.openShift.id)).status, 'open');
        } else if (kind === 'dynamic') {
          assert.equal(result.approvalChain.final, true);
        } else {
          if (status === 'Approved') {
            const execution = await one(s.automationExecutions, x.execution.id);
            assert.equal(execution.status, 'waiting_approval');
            assert.equal(execution.waitingApprovalTaskId, result.approvalChain.nextTaskId);
            const next = await one(s.approvalTasks, result.approvalChain.nextTaskId);
            assertTypedDecision(await patch(e, next, 'Approved'), { task: next, employer: e, status: 'Approved' });
            assert.equal((await one(s.automationExecutions, x.execution.id)).status, 'completed');
            ownWrites++;
          } else assert.equal((await one(s.automationExecutions, x.execution.id)).status, 'failed');
        }
        await unchanged(victim, 'source decision kept victim immutable');
        // The other attacker's SQL must remain unchanged, including after it has made its own decisions.
        await unchanged(peer, 'source decision kept peer immutable');
        const replayBefore = await snapshot(e);
        assert.equal((await patch(e, task, status)).status, 409);
        assert.deepEqual(await snapshot(e), replayBefore, 'Replay changed SQL/audit');
        ownWrites++;
      }
      before.set(e.org.id, await snapshot(e));
    }
    // Corrupt reverse links on a real foreign row are not an authorization grant.
    // The task itself is owned; a helper must not follow a foreign HCM/automation source.
    let forgedLinkDenials = 0;
    for (const e of [a, b]) for (const kind of ['hcm', 'automation']) {
      const [task] = await db.insert(s.approvalTasks).values({ organizationId: e.org.id,
        title: e.marker + ' forged reverse ' + kind, detail: 'Fictional cross-employer link',
        approver: 'role:owner', dueLabel: 'Fictional' }).returning();
      const table = kind === 'hcm' ? s.hcmBusinessProcessInstanceSteps : s.automationExecutions;
      const target = kind === 'hcm' ? v.step : v.execution;
      const link = kind === 'hcm' ? 'approvalTaskId' : 'waitingApprovalTaskId';
      const original = (await one(table, target.id))[link];
      await db.update(table).set({ [link]: task.id }).where(eq(table.id, target.id));
      const snapshots = new Map(await Promise.all(employers.map(async subject => [subject.org.id, await snapshot(subject)])));
      const denied = await patch(e, task, 'Approved');
      assert.equal(denied.status, 409, 'forged foreign ' + kind + ' reverse link must be refused before ANY decision');
      assert.equal((await one(s.approvalTasks, task.id)).status, 'Pending');
      for (const subject of employers) assert.deepEqual(await snapshot(subject), snapshots.get(subject.org.id), 'foreign reverse-link denial changed SQL/audit');
      await db.update(table).set({ [link]: original }).where(eq(table.id, target.id));
      before.set(e.org.id, await snapshot(e));
      forgedLinkDenials++;
    }
    assert.equal(ownWrites, 19);assert.equal(victimDenials, 18);assert.equal(forgedLinkDenials, 4);
    assert.equal(sourceGuardDenials, 20);assert.equal(auditRollbacks, 18);
    assert.equal(discriminations, 9);
    await unchanged(victim, 'final victim snapshot');
    const receipt = { label: 'SOLO_VERIFIED_DEV_RECOVERY', ownWrites, victimControlWrites, victimDenials, forgedLinkDenials, sourceGuardDenials, auditRollbacks, discriminations,
      families: ['hcm-effective-change', 'hcm-position-create', 'hcm-position-close', 'hcm-compensation-recommendation',
        'workforce-scenario', 'separation-handoff', 'roster-handoff', 'dynamic-group', 'automation-gate'],
      realHttpPostgres16: true, forgedBodySelectorsIgnored: true, unchangedVictimSql: true,
      coverageCredits: 0, providerCalled: false, productionCertified: false };
    console.log('APPROVAL_TYPES_COMPLETE ' + JSON.stringify(receipt));return receipt;
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proveApprovalTypes().catch(error => { console.error(error);process.exitCode = 1; });
}
