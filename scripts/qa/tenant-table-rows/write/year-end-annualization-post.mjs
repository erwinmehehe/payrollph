// Year-end annualization real-HTTP write candidate. GAP until every GET export mode
// and the exact final-head PG16 proof pass. The fixture uses only fictional payroll.
import { inArray } from 'drizzle-orm';
import {
  payrollRuns, payrollEntries, yearEndAdjustments, auditEvents,
  historicalPayrollEntries, yearEndPriorEvidence,
} from '../../../../src/db/schema.ts';

export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, auditBusinessSnapshot }) {
  const plain = value => JSON.parse(JSON.stringify(value));
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => {
    const runs = await byOrg(payrollRuns, orgId);
    const entries = runs.length ? await db.select().from(payrollEntries)
      .where(inArray(payrollEntries.payrollRunId, runs.map(run => run.id))).orderBy(asc(payrollEntries.id)) : [];
    return {
      runs: plain(runs), entries: plain(entries),
      adjustments: plain(await byOrg(yearEndAdjustments, orgId)),
      historical: plain(await byOrg(historicalPayrollEntries, orgId)),
      priorEvidence: plain(await byOrg(yearEndPriorEvidence, orgId)),
      audit: plain(auditBusinessSnapshot(await byOrg(auditEvents, orgId))),
    };
  };
  const ownBody = c => ({ organizationId: c.orgId, taxYear: 2026 });
  const foreignBody = c => ({ organizationId: c.victim.org.id, taxYear: 2026 });
  const forgedBody = c => ({ organizationId: c.orgId, taxYear: 2026, applyToPayrollRunId: c.victimSeeded.id });
  return [{
    key: 'POST year-end',
    profile: 'allowlisted-reads',
    status: 200, deny: 403,
    seed: async employer => {
      const gross = String(20000 + employer.rank * 100) + '.00';
      const tax = String(1000 + employer.rank * 10) + '.00';
      const [released] = await db.insert(payrollRuns).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        periodLabel: 'Synthetic November payroll ' + employer.marker,
        periodStart: '2026-11-01', periodEnd: '2026-11-15', payDate: '2026-11-20',
        employeeCount: 1, status: 'Released', grossPay: gross, netPay: gross,
      }).returning();
      const [entry] = await db.insert(payrollEntries).values({
        payrollRunId: released.id, employeeId: employer.worker.id,
        grossPay: gross, deductions: tax, netPay: gross,
        lineItems: [
          { code: 'BASIC', label: 'Fictional regular basic pay', amount: gross },
          { code: 'TAX', label: 'Fictional withholding tax', amount: tax },
        ], trace: { inputs: [], fictional: true, marker: employer.marker },
      }).returning();
      const [final] = await db.insert(payrollRuns).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        periodLabel: 'Synthetic December final cutoff ' + employer.marker,
        periodStart: '2026-12-16', periodEnd: '2026-12-31', payDate: '2026-12-31',
        employeeCount: 1, status: 'Needs review', grossPay: '0.00', netPay: '0.00',
      }).returning();
      assert.equal(entry.payrollRunId, released.id);
      assert.equal(final.organizationId, employer.org.id);
      return { id: final.id, releasedRunId: released.id, entryId: entry.id };
    },
    state, ownBody, foreignBody,
    forged: { status: 404, body: forgedBody },
    expect: (before, after, c, response) => {
      assert.equal(response.json?.employees, 1, 'nonempty actual annualization needed');
      assert.equal(response.json?.available2316Drafts, 1);
      assert.equal(response.json?.certificateStorage, 'not-persisted');
      assert.equal(before.adjustments.length, 0);
      assert.equal(after.adjustments.length, 1);
      const item = after.adjustments[0];
      assert.equal(item.organizationId, c.orgId);
      assert.equal(item.employeeId, c.workerId);
      assert.equal(item.taxYear, 2026);
      assert.equal(item.status, 'computed');
      assert.equal(item.payrollRunId, null);
      assert.ok(Number(item.grossCompensation) > 0);
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.audit.at(-1).action, 'Year-end annualization computed');
      assert.equal(after.audit.at(-1).organizationId, c.orgId);
      for (const table of ['runs', 'entries', 'historical', 'priorEvidence']) {
        assert.deepEqual(after[table], before[table], 'write cannot mutate source ' + table);
      }
    },
    exercise: async (c, { request, expectStatus, cookie }) => {
      const endpoint = '/api/year-end';
      const query = (orgId, format, extra = '') =>
        endpoint + '?organizationId=' + orgId + '&taxYear=2026&format=' + format + extra;
      const victimState = await state(c.victim.org.id);
      const ownSnapshot = await state(c.orgId);
      const ownRead = expectStatus(await request(query(c.orgId, 'json'), { cookie }), 200,
        'real JSON read of own calculated adjustment');
      assert.equal(ownRead.json?.count, 1);
      assert.equal(ownRead.json?.rows?.[0]?.employeeId, c.workerId);
      assert.equal(ownRead.json?.rows?.[0]?.employeeNo, c.marker);
      assert.ok(!ownRead.text.includes(c.victim.marker));
      const ownPreflight = expectStatus(await request(query(c.orgId, 'preflight'), { cookie }), 200,
        'own populated annual source preflight');
      assert.equal(ownPreflight.json?.summary?.annualizedEmployees, 1);
      assert.equal(ownPreflight.json?.summary?.payrollEmployees, 1);
      for (const format of ['json', 'preflight']) {
        const refused = expectStatus(await request(query(c.victim.org.id, format), { cookie }), 403,
          'real foreign employer year-end GET ' + format);
        assert.ok(!refused.text.includes(c.victim.marker));
        assert.deepEqual(await state(c.victim.org.id), victimState);
      }
      const forgedRead = expectStatus(await request(query(c.orgId, '2316', '&employeeId=' + c.victim.worker.id), { cookie }), 404,
        'forged victim employee selector under an own annualization');
      assert.ok(!forgedRead.text.includes(c.victim.marker));
      assert.deepEqual(await state(c.victim.org.id), victimState);
      assert.deepEqual(await state(c.orgId), ownSnapshot, 'all GET requests must be read-only');
      // Exercise the independent freshly-calculated December binding mode, not
      // just an unbound annualization which would miss the payroll run selector.
      const bound = expectStatus(await request(endpoint, { method: 'POST', cookie,
        body: { organizationId: c.orgId, taxYear: 2026, applyToPayrollRunId: c.seeded.id } }), 200,
        'own real December run binding');
      assert.equal(bound.json?.employees, 1);
      assert.equal(bound.json?.payrollSettlement?.payrollRunId, c.seeded.id);
      const after = await state(c.orgId);
      assert.equal(after.adjustments.length, 1);
      assert.equal(after.adjustments[0].employeeId, c.workerId);
      assert.equal(after.adjustments[0].payrollRunId, c.seeded.id);
      assert.ok(['approved','settled'].includes(after.adjustments[0].status));
      assert.ok(after.audit.length >= ownSnapshot.audit.length + 2,
        'annualization and bound-run audit both required');
      const foreignBound = expectStatus(await request(endpoint, { method: 'POST', cookie,
        body: { organizationId: c.victim.org.id, taxYear: 2026, applyToPayrollRunId: c.victimSeeded.id } }), 403,
        'real foreign victim December binding denied');
      assert.ok(!foreignBound.text.includes(c.victim.marker));
      const forgedBound = expectStatus(await request(endpoint, { method: 'POST', cookie,
        body: { organizationId: c.orgId, taxYear: 2026, applyToPayrollRunId: c.victimSeeded.id } }), 404,
        'forged victim December run ID under owned employer denied');
      assert.ok(!forgedBound.text.includes(c.victim.marker));
      assert.deepEqual(await state(c.victim.org.id), victimState, 'victim tax, payroll, evidence and audits unchanged');
      assert.deepEqual(await state(c.orgId), after, 'both refused binding requests must be read-only');
      return { ownAnnualizationAndBinding: 2, ownedJsonRead: 1, ownedPreflightRead: 1,
        deniedRealVictimGetAndPost: 4, rejectedForgedWorkerAndRun: 3,
        unchangedVictimDb: true, methodCredit: 0,
        note: '2316, 2316-print and alphalist successful source exports remain unproved' };
    },
  }];
}
