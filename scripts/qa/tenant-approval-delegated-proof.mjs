import assert from 'node:assert/strict';
import { assertTypedDecision } from './tenant-approval-types-contract.mjs';

export function assertDelegatedDecision(response, context) {
  assertTypedDecision(response, context);
  assert.equal(response.json.delegation?.roleMatched, false, 'must use actual delegation, not owner-role shortcut');
  assert.equal(response.json.delegation.delegated, true);
  assert.equal(response.json.delegation.permitted, true);
  assert.equal(response.json.delegation.originalApprover, context.task.approver);
  assert.equal(response.json.delegation.effectiveApprover, context.employer.owner.name);
  assert.equal(response.json.decidedOnBehalfOf, context.task.approver);
}

// Called only after the parent has checked its disposable target and PG16.
export async function proveDelegatedApprovals({ db, s, eq, employers, patch, snapshot }) {
  const [a, b, victim] = employers;
  const verify = process.env.TENANT_APPROVAL_TYPES_MUTATION === 'delegation-noop'
    ? () => {} : assertDelegatedDecision;
  const fixtures = new Map();
  const one = async (table, id) => (await db.select().from(table).where(eq(table.id, id)))[0];
  for (const e of employers) {
    const approver = e.marker + ' absent checker';
    const [task] = await db.insert(s.approvalTasks).values({ organizationId: e.org.id,
      title: e.marker + ' delegated decision', detail: 'Fictional named delegation',
      approver, dueLabel: 'Fictional' }).returning();
    const [edge] = await db.insert(s.approvalDelegations).values({ organizationId: e.org.id,
      fromApprover: approver, toApprover: e.owner.name,
      startsOn: '2000-01-01', endsOn: '2099-12-31', active: true }).returning();
    fixtures.set(e.org.id, { task, edge });
  }
  const snapshots = async () => new Map(await Promise.all(employers.map(async e => [e.org.id, await snapshot(e)])));
  const unchanged = async (before) => {
    for (const e of employers) assert.deepEqual(await snapshot(e), before.get(e.org.id), 'delegation refusal changed SQL/audit');
  };
  let refusals = 0, ownWrites = 0, captured;
  for (const e of [a, b]) {
    const { task, edge } = fixtures.get(e.org.id);
    const foreign = fixtures.get(victim.org.id);
    assert.ok(foreign.task.id > task.id && foreign.task.id > 6);
    let before = await snapshots();
    const denial = await patch(e, foreign.task, 'Approved');
    assert.equal(denial.status, 404);
    assert.deepEqual(denial.json, { error: 'Approval task not found.' });
    assert.ok(!(denial.text + JSON.stringify([...denial.headers])).includes(victim.marker));
    await unchanged(before);refusals++;
    // Each denied fixture remains a real pending, owned task with an otherwise
    // legitimate delegation. Restore only our fixture edit after each request.
    for (const changes of [{ active: false }, { endsOn: '2000-01-02' },
      { startsOn: '2099-12-30' }, { organizationId: victim.org.id }]) {
      await db.update(s.approvalDelegations).set(changes).where(eq(s.approvalDelegations.id, edge.id));
      try {
        before = await snapshots();
        assert.equal((await patch(e, task, 'Approved')).status, 403);
        await unchanged(before);refusals++;
      } finally {
        await db.update(s.approvalDelegations).set(Object.fromEntries(
          Object.keys(changes).map(key => [key, edge[key]]))).where(eq(s.approvalDelegations.id, edge.id));
      }
    }
    before = await snapshots();
    const response = await patch(e, task, 'Approved', { organizationId: victim.org.id,
      approver: victim.owner.name, delegatedBy: victim.owner.id });
    verify(response, { task, employer: e, status: 'Approved' });
    assert.equal((await one(s.approvalTasks, task.id)).status, 'Approved');
    const audits = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, e.org.id));
    const decisions = audits.filter(row => Number(row.metadata?.taskId) === task.id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].actor, e.owner.name);
    assert.equal(decisions[0].metadata.deciderUserId, e.owner.id);
    for (const other of employers.filter(other => other !== e)) assert.deepEqual(
      await snapshot(other), before.get(other.org.id), 'delegated own write changed foreign SQL');
    if (captured) assert.throws(() => verify(captured, { task, employer: e, status: 'Approved' }),
      /accepts another employer's data/, "proof accepts another employer's data");
    else captured = response;
    before = await snapshots();
    assert.equal((await patch(e, task, 'Approved')).status, 409);
    await unchanged(before);refusals++;ownWrites++;
  }
  assert.equal(ownWrites, 2);assert.equal(refusals, 12);
  return { ownWrites, refusals, discriminationChecks: 1, unchangedVictimSql: true,
    providerCalled: false, coverageCredits: 0 };
}
