/**
 * HR case mutation tenant-isolation proof. Synthetic PG16 + localhost ONLY.
 * This is a regression probe, not an API method credit or release approval.
 * No COE issuance, document storage, external providers or money operations.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  ORIGIN, requireDisposableHrPageEnv, verifyHrPageSourcePins,
  assertDeniedHrResponse,
} from './tenant-hr-cases-page-contract.mjs';

const CASE_API = '/api/hr-cases';
const plain = value => JSON.parse(JSON.stringify(value));

async function request(path, cookie, method = 'PATCH', body = null) {
  assert.ok(path === CASE_API || path === '/api/account', 'Unapproved HTTP target');
  const response = await fetch(ORIGIN + path, {
    method, redirect: 'manual', cache: 'no-store',
    headers: {
      ...(cookie ? {cookie} : {}),
      ...(method === 'PATCH' ? {
        'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin',
      } : {}),
    },
    ...(method === 'PATCH' ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Login redirects are not JSON. */ }
  return {status: response.status, text, json, headers: response.headers};
}

export async function proveHrCasePatchIsolation() {
  // These checks must precede ALL DB, application and session imports.
  requireDisposableHrPageEnv();
  verifyHrPageSourcePins();
  const [{db, pool}, s, {and, asc, eq}, fixture] = await Promise.all([
    import('../../src/db/index.ts'),
    import('../../src/db/schema.ts'),
    import('drizzle-orm'),
    import('./tenant-table-http.mjs'),
  ]);
  const protectedTables = ['employees', 'employeeHrCases',
    'employeeHrCaseMessages', 'auditEvents', 'payrollRuns'];
  async function snapshot(orgId) {
    const out = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id && table?.organizationId, 'Invalid protected table: ' + name);
      out[name] = plain(await db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id)));
    }
    return out;
  }
  let positive = 0, rejected = 0, victimImmutable = 0;
  try {
    const version = Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, 'PostgreSQL 16 is required');
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      'Unsafe database: employers already present');
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      'Unsafe database: users already present');
    const nonce = randomUUID().replaceAll('-', '').slice(0, 10);

    async function employer(label) {
      const actor = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
      return {...actor, label, cases: []};
    }
    async function newCase(actor, assignedRole, employee = actor.worker, suffix = '') {
      const [created] = await db.insert(s.employeeHrCases).values({
        organizationId: actor.org.id, employeeId: employee.id,
        createdByUserId: actor.owner.id,
        caseType: assignedRole === 'payroll' ? 'payslip_correction' : 'general',
        subject: actor.marker + ' ' + assignedRole + ' ' + suffix,
        description: actor.marker + ' fictional confidential HR case',
        assignedRole, status: 'open',
        slaDueAt: new Date(Date.now() + 72 * 3600000),
      }).returning();
      actor.cases.push(created);
      return created;
    }
    const filler = [];
    for (let n = 0; n < 7; n++) {
      const f = await employer('FILL' + n);
      await newCase(f, 'hr');
      filler.push(f);
    }
    const a = await employer('ATTA');
    const aHr = await newCase(a, 'hr');
    const aPayroll = await newCase(a, 'payroll');
    const b = await employer('ATTB');
    const bHr = await newCase(b, 'hr');
    const victim = await employer('VICTIM');
    const victimHr = await newCase(victim, 'hr');
    const allActors = [a, b, victim];

    assert.ok(victimHr.id > Math.max(aHr.id, aPayroll.id, bHr.id, 6));
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.equal(new Set(allActors.map(actor => actor.cookie)).size, 3);

    // A genuinely assigned HR reviewer may not edit a different department.
    const [otherUnit] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: a.entity.id,
      type: 'department', code: 'OTHER-' + nonce, name: 'Fictional separate unit',
    }).returning();
    const [otherWorker] = await db.insert(s.employees).values({
      organizationId: a.org.id, legalEntityId: a.entity.id,
      orgUnitId: otherUnit.id, employeeNo: 'OTHER-' + nonce,
      firstName: 'Fictional', lastName: 'Separate', title: 'Worker',
      avatarInitials: 'FS', basicRate: '25000.00', startDate: '2026-01-05',
    }).returning();
    const otherUnitCase = await newCase(a, 'hr', otherWorker, 'other-unit');

    async function staffUser(role, unitId) {
      const [user] = await db.insert(s.users).values({
        email: 'hr-write-' + role + '-' + nonce + '@example.invalid',
        name: 'Fictional ' + role + ' reviewer', passwordHash: 'fixture-only',
        role: 'owner', totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: user.id, role,
        orgUnitId: unitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({mfaVerifiedAt: new Date()})
        .where(eq(s.sessions.id, session.id));
      return {cookie: session.cookie, user};
    }
    const hr = await staffUser('hr', a.unit.id);
    const payroll = await staffUser('payroll', a.unit.id);
    const bookkeeper = await staffUser('bookkeeper', a.unit.id);

    const victimBaseline = await snapshot(victim.org.id);
    async function verifyVictim(label) {
      assert.deepEqual(await snapshot(victim.org.id), victimBaseline,
        label + ': victim case, message, employee, payroll or audit changed');
      victimImmutable++;
    }
    async function own(cookie, actor, id, action, extras = {}) {
      const before = await snapshot(actor.org.id);
      const marker = actor.marker + ' synthetic own case response';
      const resp = await request(CASE_API, cookie, 'PATCH', {
        id, action, ...(action === 'status' ? {status: 'in_progress'} : {message: marker}),
        ...extras,
      });
      assert.equal(resp.status, 200, actor.label + ' owned PATCH must succeed: ' + resp.text.slice(0, 160));
      assert.equal(resp.json?.case?.organizationId, actor.org.id);
      assert.equal(resp.json?.case?.id, id);
      const after = await snapshot(actor.org.id);
      assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
        'A real owned PATCH must persist an audit event');
      if (action === 'reply' || action === 'internal_note') {
        assert.equal(after.employeeHrCaseMessages.length, before.employeeHrCaseMessages.length + 1);
        const newMessage = after.employeeHrCaseMessages.at(-1);
        assert.equal(newMessage.caseId, id);
        assert.equal(newMessage.organizationId, actor.org.id);
        assert.equal(newMessage.body, marker);
        assert.equal(newMessage.visibility, action === 'internal_note' ? 'internal' : 'employee');
      } else {
        assert.equal(after.employeeHrCaseMessages.length, before.employeeHrCaseMessages.length);
        const updated = after.employeeHrCases.find(row => row.id === id);
        assert.equal(updated.status, 'in_progress');
      }
      positive++;
      await verifyVictim('positive action');
    }
    async function deny(cookie, caseId, expected, label, extra = {}) {
      const before = await Promise.all(allActors.map(actor => snapshot(actor.org.id)));
      const resp = await request(CASE_API, cookie, 'PATCH',
        {id: caseId, action: 'internal_note', message: 'Do not persist this note', ...extra});
      assertDeniedHrResponse(resp, expected, allActors, label);
      for (let n = 0; n < allActors.length; n++)
        assert.deepEqual(await snapshot(allActors[n].org.id), before[n],
          label + ': rejected PATCH mutated ' + allActors[n].label);
      rejected++;
      await verifyVictim(label);
    }

    const checkSession = await request('/api/account', a.cookie, 'GET');
    assert.equal(checkSession.status, 200);
    assert.equal(checkSession.json?.profile?.id, a.owner.id);
    await own(a.cookie, a, aHr.id, 'reply');
    await own(b.cookie, b, bHr.id, 'reply');
    await own(hr.cookie, a, aHr.id, 'internal_note');
    await own(payroll.cookie, a, aPayroll.id, 'status');

    for (const actor of [a, b]) {
      for (const foreign of allActors.filter(x => x !== actor)) {
        await deny(actor.cookie, foreign.cases[0].id, 404,
          actor.label + ' cannot write ' + foreign.label);
      }
    }
    // Client-supplied employer/worker IDs must never target victim rows.
    await deny(a.cookie, victimHr.id, 404, 'forged victim employer/worker',
      {organizationId: victim.org.id, employeeId: victim.worker.id});
    await deny(hr.cookie, aPayroll.id, 404, 'HR reviewer cannot change payroll case');
    await deny(payroll.cookie, aHr.id, 404, 'Payroll reviewer cannot change HR case');
    await deny(hr.cookie, otherUnitCase.id, 404, 'Unit HR cannot change other-unit case');
    await deny(bookkeeper.cookie, aHr.id, 404, 'Bookkeeper cannot change HR case');
    await deny(undefined, aHr.id, 401, 'Anonymous user cannot change HR case');
    await deny(a.cookie, 0, 422, 'Zero case ID is invalid');
    await deny(a.cookie, 'not-a-case', 422, 'Malformed case ID is invalid');

    // The owner session stays valid after a membership is explicitly revoked,
    // but case mutations must be rejected on that very same session.
    const [revoked] = await db.update(s.userOrganizations).set({active: false})
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked.userId, a.owner.id);
    const intactSession = await request('/api/account', a.cookie, 'GET');
    assert.equal(intactSession.status, 200);
    assert.equal(intactSession.json?.profile?.id, a.owner.id);
    await deny(a.cookie, aHr.id, 404, 'Revoked membership must deny write');

    assert.equal(positive, 4);
    assert.equal(rejected, 13);
    console.log(JSON.stringify({
      kind: 'tenant-hr-cases-patch-isolation',
      evidence: 'FICTIONAL_PG16_HTTP_ONLY',
      employers: filler.length + allActors.length,
      ownPersistedWrites: positive, refusedWrites: rejected,
      victimSqlChecks: victimImmutable, twoIndependentOwners: true,
      realHigherIdVictim: true, staffRoleUnitScopeVerified: true,
      revokedStillAuthenticatedDenied: true, providerCalls: 0, 
      newMethodCredits: 0, newPageCredits: 0,
      independentlyAccepted: false, productionAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith('tenant-hr-cases-patch-http.mjs'))
  await proveHrCasePatchIsolation();
