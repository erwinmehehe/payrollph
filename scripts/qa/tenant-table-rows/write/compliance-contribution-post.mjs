// Fictional disposable-PG16 table row: all contribution-case POST actions.
// Keep GAP in the authoritative manifest until the exact final PR-head HTTP proof passes.
import { and } from 'drizzle-orm';
import {
  statutoryContributionIssueCases as cases,
  statutoryContributionIssueEvents as events,
  complianceActionTasks as tasks,
  statutoryRemittanceBatches as batches,
  statutoryRemittanceMembers as members,
  payrollMonthClosures as closures,
  auditEvents,
  payrollRuns,
  yearEndAdjustments,
} from '../../../../src/db/schema.ts';

export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, auditBusinessSnapshot }) {
  const plain = value => JSON.parse(JSON.stringify(value));
  const byOrg = (table, organizationId) => db.select().from(table)
    .where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
  const state = async organizationId => ({
    cases: plain(await byOrg(cases, organizationId)),
    events: plain(await byOrg(events, organizationId)),
    tasks: plain(await byOrg(tasks, organizationId)),
    batches: plain(await byOrg(batches, organizationId)),
    members: plain(await byOrg(members, organizationId)),
    closures: plain(await byOrg(closures, organizationId)),
    payroll: plain(await byOrg(payrollRuns, organizationId)),
    yearEnd: plain(await byOrg(yearEndAdjustments, organizationId)),
    audit: plain(auditBusinessSnapshot(await byOrg(auditEvents, organizationId))),
  });
  const requestBody = (orgId, caseId, action, extra = {}) => ({ organizationId: orgId, caseId, action, ...extra });
  const ownBody = c => requestBody(c.orgId, c.seeded.id, 'start_review');
  const foreignBody = c => requestBody(c.victim.org.id, c.victimSeeded.id, 'start_review');
  const victimSelectorBody = c => requestBody(c.orgId, c.victimSeeded.id, 'start_review');
  const findCase = (snapshot, id) => {
    const record = snapshot.cases.find(row => row.id === id);
    assert.ok(record, 'a real persisted case must exist');
    return record;
  };
  return [{
    key: 'POST compliance/contribution-issues',
    profile: 'compliance-posts',
    status: 200,
    deny: 403,
    seed: async employer => {
      const [issue] = await db.insert(cases).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        employeeId: employer.worker.id, agency: 'SSS', applicableMonth: '2026-01',
        issueType: 'other', description: 'Fictional contribution case for ' + employer.marker,
        employeeSnapshot: { employeeNo: employer.worker.employeeNo, marker: employer.marker },
        reportedByUserId: employer.owner.id, reportedByName: employer.owner.name,
      }).returning();
      const [task] = await db.insert(tasks).values({
        organizationId: employer.org.id,
        sourceType: 'employee_contribution_issue',
        sourceKey: 'employee-contribution-issue:' + issue.id,
        agency: 'SSS', applicableMonth: '2026-01', severity: 'low',
        title: 'Fictional contribution case ' + employer.marker,
        detail: 'Fictional evidence-only tenant isolation fixture',
      }).returning();
      assert.equal(task.organizationId, employer.org.id);
      return { id: issue.id, taskId: task.id };
    },
    state, ownBody, foreignBody,
    forged: { status: 404, body: victimSelectorBody },
    expect: (before, after, c, response) => {
      assert.equal(response.json?.case?.id, c.seeded.id);
      assert.equal(response.json?.case?.organizationId, c.orgId);
      assert.equal(findCase(before, c.seeded.id).status, 'open');
      const issue = findCase(after, c.seeded.id);
      assert.equal(issue.status, 'in_review');
      assert.equal(issue.assignedToUserId, c.owner.id);
      assert.equal(issue.employeeId, c.workerId);
      assert.equal(after.events.length, before.events.length + 1);
      const event = after.events.at(-1);
      assert.equal(event.organizationId, c.orgId);
      assert.equal(event.caseId, issue.id);
      assert.equal(event.eventType, 'review_started');
      assert.equal(after.tasks.find(row => row.id === c.seeded.taskId)?.status, 'in_progress');
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.audit.at(-1).organizationId, c.orgId);
      assert.equal(after.audit.at(-1).action, 'Employee contribution issue review started');
      for (const table of ['batches', 'members', 'closures', 'payroll', 'yearEnd']) {
        assert.deepEqual(after[table], before[table], 'review cannot change ' + table);
      }
    },
    exercise: async (c, { request, expectStatus, cookie }) => {
      const endpoint = '/api/compliance/contribution-issues';
      const ownState = () => state(c.orgId);
      const victimState = () => state(c.victim.org.id);
      const actionBodies = [
        ['add_update', { message: 'Fictional employee-visible review update ' + c.marker }, 'in_review', 'payroll_update'],
        ['resolve', { resolutionOutcome: 'referred_to_agency', resolutionNote: 'Fictional agency referral with preserved source evidence ' + c.marker }, 'in_review', 'payroll_update'],
        ['resolve', { resolutionOutcome: 'employee_advised', resolutionNote: 'Fictional case review completed with verified own evidence ' + c.marker }, 'resolved', 'resolved'],
      ];
      let positives = 1, foreignDenials = 1, forgedDenials = 1;
      const seededVictim = await victimState();
      for (const [action, extra, status, eventType] of actionBodies) {
        const before = await ownState();
        const body = requestBody(c.orgId, c.seeded.id, action, extra);
        const positive = expectStatus(await request(endpoint, { method: 'POST', cookie, body }), 200,
          'real owned contribution case ' + action);
        assert.equal(positive.json?.case?.id, c.seeded.id);
        assert.equal(positive.json?.case?.organizationId, c.orgId);
        const after = await ownState();
        assert.equal(findCase(after, c.seeded.id).status, status);
        assert.equal(after.events.length, before.events.length + 1, 'one and only one case event');
        assert.equal(after.events.at(-1).eventType, eventType);
        assert.equal(after.events.at(-1).caseId, c.seeded.id);
        if (extra.resolutionOutcome === 'referred_to_agency') {
          assert.equal(findCase(after, c.seeded.id).resolutionOutcome, 'referred_to_agency');
          assert.equal(positive.json?.resolved, false, 'referral must not close the case');
          assert.ok(after.events.at(-1).message.startsWith('Referred to the agency for verification.'),
            'allowed payroll_update event must retain explicit referral meaning');
          assert.equal(after.audit.at(-1).action, 'Employee contribution issue referred to agency');
        }
        assert.equal(after.audit.length, before.audit.length + 1, 'one business audit per action');
        assert.equal(after.audit.at(-1).organizationId, c.orgId);
        assert.notDeepEqual(after, before, 'own action has a genuine persisted SQL change');
        for (const table of ['batches', 'members', 'closures', 'payroll', 'yearEnd']) {
          assert.deepEqual(after[table], before[table], 'case action cannot mutate money table ' + table);
        }
        positives++;
        const foreign = expectStatus(await request(endpoint, { method: 'POST', cookie,
          body: requestBody(c.victim.org.id, c.victimSeeded.id, action, extra) }), 403,
          'real higher-ID victim employer denied ' + action);
        assert.ok(!foreign.text.includes(c.victim.marker));
        assert.deepEqual(await ownState(), after, 'foreign denial cannot mutate actor employer');
        assert.deepEqual(await victimState(), seededVictim, 'foreign denial cannot mutate victim SQL');
        foreignDenials++;
        const forged = expectStatus(await request(endpoint, { method: 'POST', cookie,
          body: requestBody(c.orgId, c.victimSeeded.id, action, extra) }), 404,
          'real higher-ID victim case selector rejected ' + action);
        assert.ok(!forged.text.includes(c.victim.marker));
        assert.deepEqual(await ownState(), after, 'forged denial cannot mutate actor employer');
        assert.deepEqual(await victimState(), seededVictim, 'forged denial cannot mutate victim SQL');
        forgedDenials++;
      }
      return { actions: ['start_review', 'add_update', 'resolve:referral', 'resolve:employee_advised'],
        ownPositiveActions: positives, realVictimDenials: foreignDenials,
        forgedVictimCaseDenials: forgedDenials, victimDatabaseUnchanged: true,
        credit: 0, note: 'POST method still GAP pending all-action review and exact-final-head CI' };
    },
  }];
}
