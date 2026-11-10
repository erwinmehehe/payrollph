import assert from 'node:assert/strict';
import { assertTypedDecision } from './tenant-approval-types-contract.mjs';

export function assertPayrollDecline(response, context) {
  assertTypedDecision(response, { ...context, status: 'Declined' });
  assert.equal(response.json.payrollRunId, context.run.id, 'wrong payroll run decided');
  assert.equal(response.json.leaveUpdated, false);
}

// Uses the parent's already-verified private PG16/HTTP target. No calculation,
// payroll release, schema migration, flag change or provider request occurs.
export async function provePayrollDeclines({ db, pool, s, eq, employers, patch, snapshot }) {
  const { managedPayrollRunFingerprint } = await import('../../src/lib/managed-payroll.ts');
  const [a, b, victim] = employers;
  const verify = process.env.TENANT_APPROVAL_TYPES_MUTATION === 'payroll-decline-noop'
    ? () => {} : assertPayrollDecline;
  const one = async (table, id) => (await db.select().from(table).where(eq(table.id, id)))[0];
  const fixtures = new Map();
  async function seed(e, suffix, makerIsChecker = false) {
    const [maker] = await db.insert(s.users).values({ email: e.marker + '-payroll-decline-' + suffix + '@example.invalid',
      name: e.marker + ' payroll maker ' + suffix, passwordHash: 'fictional-only', role: 'hr' }).returning();
    await db.insert(s.userOrganizations).values({ userId: maker.id, organizationId: e.org.id, role: 'hr', active: true });
    const [run] = await db.insert(s.payrollRuns).values({ organizationId: e.org.id, legalEntityId: e.entity.id,
      periodLabel: e.marker + ' rejection ' + suffix, periodStart: '2026-01-01', periodEnd: '2026-01-15',
      payDate: '2026-01-16', employeeCount: 1, grossPay: '100', netPay: '90', status: 'Pending approval' }).returning();
    await db.insert(s.payrollEntries).values({ payrollRunId: run.id, employeeId: e.worker.id,
      grossPay: '100', deductions: '10', netPay: '90', lineItems: [{ code: 'BASIC', amount: 100 }] });
    const fingerprint = await managedPayrollRunFingerprint(run.id);
    const [task] = await db.insert(s.approvalTasks).values({ organizationId: e.org.id,
      title: e.marker + ' reject payroll ' + suffix, detail: 'Fictional structurally linked payroll',
      approver: e.owner.name, dueLabel: 'Fictional', payrollRunId: run.id, payrollFingerprint: fingerprint,
      payrollGross: run.grossPay, payrollNet: run.netPay, payrollEmployeeCount: 1 }).returning();
    const [submission] = await db.insert(s.auditEvents).values({ organizationId: e.org.id,
      actor: makerIsChecker ? e.owner.name : maker.name, action: 'Payroll submitted for review', resource: run.periodLabel,
      metadata: { runId: run.id, taskId: task.id, makerUserId: makerIsChecker ? e.owner.id : maker.id, approverUserId: e.owner.id,
        payrollFingerprint: fingerprint, grossPay: run.grossPay, netPay: run.netPay, employeeCount: 1 } }).returning();
    return { task, run, submission };
  }
  for (const e of employers) {
    if (e === victim) await db.insert(s.payrollRuns).values(Array.from({ length: 7 }, (_, i) => ({
      organizationId: e.org.id, legalEntityId: e.entity.id, periodLabel: 'Fictional padding ' + i,
      periodStart: '2025-01-01', periodEnd: '2025-01-15', payDate: '2025-01-16', status: 'Draft',
    })));
    fixtures.set(e.org.id, await seed(e, 'target'));
  }
  // A separate victim positive proves this is a genuinely reachable payroll
  // rejection, while the real victim task attacked below remains pending.
  const control = await seed(victim, 'control');
  verify(await patch(victim, control.task, 'Declined'), { ...control, employer: victim });
  assert.equal((await one(s.payrollRuns, control.run.id)).status, 'Needs review');
  assert.equal((await one(s.approvalTasks, control.task.id)).status, 'Declined');
  const snapshots = async () => new Map(await Promise.all(employers.map(async e => [e.org.id, await snapshot(e)])));
  const unchanged = async before => {
    for (const e of employers) assert.deepEqual(await snapshot(e), before.get(e.org.id), 'payroll refusal changed SQL/audit');
  };
  let ownWrites = 0, refusals = 0, captured;
  for (const e of [a, b]) {
    const x = fixtures.get(e.org.id), foreign = fixtures.get(victim.org.id);
    assert.ok(foreign.task.id > x.task.id && foreign.task.id > 6);
    assert.ok(foreign.run.id > Math.max(x.run.id, 6));
    let before = await snapshots();
    const denied = await patch(e, foreign.task, 'Declined', { organizationId: e.org.id });
    assert.equal(denied.status, 404);assert.deepEqual(denied.json, { error: 'Approval task not found.' });
    assert.ok(!(denied.text + JSON.stringify([...denied.headers])).includes(victim.marker));
    await unchanged(before);refusals++;
    for (const [table, row, changes, status] of [
      [s.approvalTasks, x.task, { payrollRunId: foreign.run.id }, 409],
      [s.approvalTasks, x.task, { payrollFingerprint: '0'.repeat(64) }, 409],
    ]) {
      await db.update(table).set(changes).where(eq(table.id, row.id));
      try {
        before = await snapshots();
        assert.equal((await patch(e, x.task, 'Declined')).status, status);
        await unchanged(before);refusals++;
      } finally {
        await db.update(table).set(Object.fromEntries(Object.keys(changes).map(key => [key, row[key]]))).where(eq(table.id, row.id));
      }
    }
    // Preserve the append-only audit chain. Seed a distinct genuine submission
    // by the same authenticated maker/checker rather than rewriting audit rows.
    const selfMade = await seed(e, 'maker-negative', true);
    before = await snapshots();
    assert.equal((await patch(e, selfMade.task, 'Declined')).status, 403);
    await unchanged(before);refusals++;
    // A real PostgreSQL audit insert failure must roll back BOTH payroll and task.
    await pool.query("CREATE FUNCTION qa_payroll_decline_veto() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'Approval declined' THEN RAISE EXCEPTION 'QA_PAYROLL_DECLINE_VETO'; END IF; RETURN NEW; END $$");
    await pool.query('CREATE TRIGGER qa_payroll_decline_veto BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_payroll_decline_veto()');
    try {
      before = await snapshots();
      assert.equal((await patch(e, x.task, 'Declined')).status, 500);
      await unchanged(before);refusals++;
    } finally {
      await pool.query('DROP TRIGGER qa_payroll_decline_veto ON audit_events');
      await pool.query('DROP FUNCTION qa_payroll_decline_veto()');
    }
    before = await snapshots();
    const response = await patch(e, x.task, 'Declined', { organizationId: victim.org.id,
      payrollRunId: foreign.run.id, runId: foreign.run.id, approverUserId: victim.owner.id });
    verify(response, { ...x, employer: e });
    assert.equal((await one(s.payrollRuns, x.run.id)).status, 'Needs review');
    assert.equal((await one(s.approvalTasks, x.task.id)).status, 'Declined');
    const audits = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, e.org.id));
    const decision = audits.filter(row => row.action === 'Approval declined' && Number(row.metadata?.taskId) === x.task.id);
    assert.equal(decision.length, 1);assert.equal(decision[0].metadata.deciderUserId, e.owner.id);
    for (const other of employers.filter(other => other !== e)) assert.deepEqual(await snapshot(other), before.get(other.org.id));
    if (captured) assert.throws(() => verify(captured, { ...x, employer: e }), /accepts another employer's data/,
      "proof accepts another employer's data");
    else captured = response;
    before = await snapshots();assert.equal((await patch(e, x.task, 'Declined')).status, 409);
    await unchanged(before);refusals++;ownWrites++;
  }
  assert.equal(ownWrites, 2);assert.equal(refusals, 12);
  return { ownWrites, victimControlWrites: 1, refusals, auditRollbacks: 2,
    discriminationChecks: 1, unchangedVictimSql: true, coverageCredits: 0, providerCalled: false };
}
