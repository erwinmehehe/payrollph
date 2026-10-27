// Provisional read-only POST proof; fictional disposable PG16 and localhost only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requireDisposableLeavePreview } from './tenant-leave-preview-guard.mjs';

async function main() {
  requireDisposableLeavePreview();
  const [{ db, pool }, s, table, { eq }] = await Promise.all([
    import('../../src/db/index.ts'), import('../../src/db/schema.ts'),
    import('./tenant-table-http.mjs'), import('drizzle-orm'),
  ]);
  try {
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      'LEAVE_PREVIEW_PROOF_REFUSED: database must be fresh and empty');
    const nonce = randomUUID().replaceAll('-', '').slice(0, 10);
    const employers = [];
    for (const label of ['ATTA', 'ATTB', 'VICTIM']) employers.push(await table.seedEmployer(label, nonce, table.standaloneMakeSession));
    const [a, b, victim] = employers;
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    const snapshot = async orgId => {
      const result = {};
      for (const [name, t] of Object.entries({ workers: s.employees, leave: s.leaveRequests,
        balances: s.leaveBalances, audit: s.auditEvents, payroll: s.payrollRuns })) {
        result[name] = await db.select().from(t).where(eq(t.organizationId, orgId)).orderBy(t.id);
      }
      return result;
    };
    const before = await Promise.all(employers.map(e => snapshot(e.org.id)));
    const body = (org, worker) => ({ organizationId: org.id, employeeId: worker.id,
      intervals: [{ kind: 'full_day', workDate: '2026-03-09', timezone: 'Asia/Manila' }] });
    const request = (e, targetOrg, targetWorker) => table.standaloneRequest('/api/leave/preview', {
      method: 'POST', cookie: e.cookie, body: body(targetOrg, targetWorker),
    });
    const ownVictim = await request(victim, victim.org, victim.worker);
    assert.equal(ownVictim.status, 200, 'victim must have a real positive preview');
    assert.equal(ownVictim.json.employee.id, victim.worker.id);
    const prove = (response, employer) => {
      assert.equal(response.json.employee.id, employer.worker.id);
      assert.equal(response.json.employee.employeeNo, employer.marker);
      assert.ok(Array.isArray(response.json.previews) && response.json.previews.length === 1);
    };
    let first;
    for (const attacker of [a, b]) {
      const own = await request(attacker, attacker.org, attacker.worker);
      assert.equal(own.status, 200, 'own preview must succeed: ' + own.text.slice(0, 200));
      prove(own, attacker);
      if (first) assert.throws(() => prove(first, attacker), 'proof accepts another employer\'s data');
      first = own;
      const foreign = await request(attacker, victim.org, victim.worker);
      assert.equal(foreign.status, 403, 'foreign organization must be refused');
      assert.ok(!foreign.text.includes(victim.marker));
      const forged = await request(attacker, attacker.org, victim.worker);
      assert.equal(forged.status, 404, 'foreign worker in own organization must be refused');
      assert.ok(!forged.text.includes(victim.marker));
    }
    const after = await Promise.all(employers.map(e => snapshot(e.org.id)));
    assert.deepEqual(after, before, 'read-only previews and denials must not change tenant or audit state');
    console.log(JSON.stringify({ method: 'POST /api/leave/preview', ownAndForeignPairs: 2,
      forgedWorkerDenials: 2, victimOwnPositive: true, allTenantStateUnchanged: true,
      realHttpPg16: true, productionCertified: false, manifestCredit: false }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
