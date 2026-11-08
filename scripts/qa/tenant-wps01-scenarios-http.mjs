/**
 * WPS-01: standalone tenant-isolation evidence for POST workforce-planning/scenarios.
 * A separate proof family from shared tenant tables and other current PRs.
 * Real production-build HTTP, real fictional employer rows, disposable PG16 only.
 * No API code changes, production calls, payroll execution or new coverage credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireLocalRecovery, assertLocalRecoveryDatabase, recoveryReceipt, RECOVERY_MODE } from './tenant-recovery-local-contract.mjs';
import {
  WPS01_METHOD, requireDisposableWps01,
  assertWps01Created, assertWps01Denied, assertWps01Unchanged,
} from "./tenant-wps01-scenarios-contract.mjs";

const PATH = "/api/workforce-planning/scenarios";

export async function proveWps01Scenarios() {
  // MUST precede any import of the DB, Drizzle schema or shared fixture.
  const localRecovery=process.env.TENANT_RECOVERY_MODE===RECOVERY_MODE;
  if(localRecovery) requireLocalRecovery(); else requireDisposableWps01();
  const [{ db, pool }, s, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  fixture.requireTenantTableDisposable();
  const { eq, asc } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const {
    users, organizations, workforcePlans, workforcePlanningScenarios, orgUnits,
    employees, employeePayProfiles, userOrganizations, auditEvents, payrollRuns,
    approvalChainInstances, approvalTasks,
  } = s;
  const version = await pool.query("SHOW server_version_num");
  if(localRecovery) await assertLocalRecoveryDatabase(pool);
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16,
    "WPS01_REFUSED: a real, disposable PostgreSQL 16 is required");
  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "WPS01_REFUSED: fixture database must be empty of all users");
    assert.equal((await db.select().from(organizations).limit(1)).length, 0,
      "WPS01_REFUSED: fixture database must be empty of all employers");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    const employers = [a, b, victim];
    for (const field of ["org", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "the victim must be a real higher-ID employer, user, unit and worker");
    }
    const plans = new Map();
    for (const e of employers) {
      const [plan] = await db.insert(workforcePlans).values({
        organizationId: e.org.id, name: e.marker + " WPS01 owned plan",
        startDate: "2026-01-01", endDate: "2026-12-31",
      }).returning();
      plans.set(e.org.id, plan);
    }
    const victimPlan = plans.get(victim.org.id);
    assert.ok(victimPlan.id > plans.get(a.org.id).id &&
      victimPlan.id > plans.get(b.org.id).id,
      "the forged foreign plan must be real and higher-ID");

    async function state(orgId) {
      const read = table => db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      return {
        organization: await db.select().from(organizations).where(eq(organizations.id, orgId)),
        plans: await read(workforcePlans),
        scenarios: await read(workforcePlanningScenarios),
        units: await read(orgUnits),
        staff: await read(employees),
        payProfiles: await read(employeePayProfiles),
        memberships: await read(userOrganizations),
        payroll: await read(payrollRuns),
        approvals: await read(approvalChainInstances),
        approvalTasks: await read(approvalTasks),
        audits: await read(auditEvents),
      };
    }
    const allStates = async () => Promise.all(employers.map(e => state(e.org.id)));
    const body = (e, name, overrides = {}) => ({
      organizationId: e.org.id, planId: plans.get(e.org.id).id, name,
      startDate: "2026-01-01", endDate: "2026-03-31",
      demandGrowthPercent: 5, vacancyFillPercent: 90,
      employerLoadPercent: 0, annualAttritionPercent: 10, attritionBackfillPercent: 80,
      ...overrides,
    });
    const post = (e, payload) =>
      standaloneRequest(PATH, { method: "POST", cookie: e?.cookie, body: payload });
    const forbidden = [victim.marker, victim.owner.email];
    let createdOwn = 0, denied = 0, immutableVersions = 0;

    async function deniedWithoutWrites(e, payload, status, label) {
      const before = await allStates();
      const response = await post(e, payload);
      assertWps01Denied(response, status, forbidden);
      assertWps01Unchanged(before, await allStates(), label);
      denied++;
      return response;
    }
    async function createAndProve(e, payload, expectedVersion) {
      const before = await allStates();
      const response = await post(e, payload);
      const after = await allStates();
      const slot = employers.indexOf(e);
      assert.ok(slot >= 0, "the successful owner must be a seeded fictional employer");
      for (let i = 0; i < employers.length; i++) {
        if (i !== slot) {
          assertWps01Unchanged(before[i], after[i],
            "owned scenario creation cannot mutate another employer " + employers[i].marker);
        }
      }
      const ownBefore = before[slot], ownAfter = after[slot];
      const added = ownAfter.scenarios.filter(row =>
        !ownBefore.scenarios.some(existing => existing.id === row.id));
      assert.equal(added.length, 1, "a successful POST must insert exactly one real scenario");
      const row = assertWps01Created(response, added[0], e, plans.get(e.org.id), expectedVersion);
      const wrongEmployer=e===victim?a:victim;
      assert.throws(()=>assertWps01Created(response,added[0],wrongEmployer,
        plans.get(wrongEmployer.org.id),expectedVersion), /foreign scenario/,
        "scenario validator accepts another employer's data");
      assert.equal(row.name, payload.name);
      assert.equal(row.scopeOrgUnitId, payload.scopeOrgUnitId ?? null,
        "the saved scenario must respect the authorized employer unit scope");
      assert.deepEqual(ownAfter.scenarios.filter(item => item.id !== row.id),
        ownBefore.scenarios, "old scenario versions are immutable");
      for (const key of [
        "organization", "plans", "units", "staff", "payProfiles",
        "memberships", "payroll", "approvals", "approvalTasks",
      ]) {
        assertWps01Unchanged(ownBefore[key], ownAfter[key],
          "own " + key + " must not be modified by scenario creation");
      }
      const audits = ownAfter.audits.filter(item =>
        !ownBefore.audits.some(existing => existing.id === item.id));
      assert.equal(audits.length, 1, "a real scenario must create exactly one audit receipt");
      assert.equal(audits[0].organizationId, e.org.id);
      assert.equal(audits[0].actor, e.owner.name);
      assert.equal(audits[0].action, "Workforce staffing scenario saved");
      assert.equal(audits[0].metadata?.scenarioId, row.id,
        "transactionally persisted audit must identify the same scenario");
      assert.equal(audits[0].resource, row.name + " v" + row.version);
      assert.equal(response.json?.scenario?.snapshotHash, row.snapshotHash);
      assert.ok(!response.text.includes(victim.marker) || e === victim,
        "successful attacker response disclosed the victim");
      createdOwn++;
      return row;
    }

    // Anonymous JSON POST must never reach a forecast or create anything.
    await deniedWithoutWrites(null, body(a, a.marker + " anonymous"), 401,
      "anonymous request with a valid employer and plan");
    const firstA = await createAndProve(a, body(a, a.marker + " owned scenario"), 1);
    const firstB = await createAndProve(b, body(b, b.marker + " owned scenario"), 1);
    const realVictim = await createAndProve(victim, body(victim, victim.marker + " protected scenario"), 1);
    assert.ok(realVictim.id > firstA.id && realVictim.id > firstB.id,
      "higher-ID victim scenario is persisted before attack probes");

    for (const attacker of [a, b]) {
      const plan = plans.get(attacker.org.id);
      const ownPayload = body(attacker, attacker.marker + " selector probe");

      // A session for employer A/B must not authorize a real third employer.
      await deniedWithoutWrites(attacker, {
        ...ownPayload, organizationId: victim.org.id, planId: victimPlan.id,
      }, 403, "foreign employer selector");

      // Real victim IDs and missing IDs must be indistinguishable.
      const foreignPlan = await deniedWithoutWrites(attacker, {
        ...ownPayload, planId: victimPlan.id,
      }, 404, "real victim linked plan");
      const missingPlan = await deniedWithoutWrites(attacker, {
        ...ownPayload, planId: 2147483647,
      }, 404, "nonexistent linked plan");
      assert.deepEqual(foreignPlan.json, missingPlan.json,
        "a foreign plan and absent plan must not form a cross-tenant existence oracle");

      const foreignUnit = await deniedWithoutWrites(attacker, {
        ...ownPayload, scopeOrgUnitId: victim.unit.id,
      }, 403, "real victim organization-unit scope");
      const missingUnit = await deniedWithoutWrites(attacker, {
        ...ownPayload, scopeOrgUnitId: 2147483647,
      }, 403, "nonexistent organization-unit scope");
      assert.deepEqual(foreignUnit.json, missingUnit.json,
        "a foreign unit and missing unit must not form a cross-tenant existence oracle");

      const scoped = await createAndProve(attacker, body(attacker,
        attacker.marker + " valid scoped scenario", { scopeOrgUnitId: attacker.unit.id }), 1);
      assert.equal(scoped.snapshot?.scope?.orgUnitId, attacker.unit.id,
        "the saved forecast must be scoped to this employer's actual org unit");
      const repeat = await createAndProve(attacker, body(attacker,
        attacker.marker + " owned scenario", { demandGrowthPercent: 8 }), 2);
      assert.ok(repeat.id > (attacker === a ? firstA.id : firstB.id));
      immutableVersions++;
      assert.equal(plan.organizationId, attacker.org.id,
        "plan must be a genuine seeded own-employer plan");
    }

    // A session cookie is NOT an employer grant after revoked membership.
    // Actual audit failure must roll back both the scenario and receipt. A
    // sequence is nontransactional, proving this reached the audit insertion.
    let auditRollbacks=0;
    await pool.query("CREATE SEQUENCE qa_recovery_audit_reached");
    await pool.query("CREATE FUNCTION qa_recovery_audit_veto() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'Workforce staffing scenario saved' THEN PERFORM nextval('qa_recovery_audit_reached'); RAISE EXCEPTION 'QA_RECOVERY_AUDIT_VETO'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER qa_recovery_audit_veto BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_recovery_audit_veto()");
    try {
      for(const attacker of [a,b]) {
        const before=await allStates();
        const seqBefore=(await pool.query('SELECT last_value,is_called FROM qa_recovery_audit_reached')).rows[0];
        const response=await post(attacker,body(attacker,attacker.marker+' audit rollback'));
        assertWps01Denied(response,422,forbidden);
        const seqAfter=(await pool.query('SELECT last_value,is_called FROM qa_recovery_audit_reached')).rows[0];
        assert.ok(seqAfter.is_called && (!seqBefore.is_called || Number(seqAfter.last_value)>Number(seqBefore.last_value)),
          'the audit veto was actually reached');
        assertWps01Unchanged(before,await allStates(),'audit-veto scenario rollback');
        auditRollbacks++;
      }
    }finally{
      await pool.query('DROP TRIGGER qa_recovery_audit_veto ON audit_events');
      await pool.query('DROP FUNCTION qa_recovery_audit_veto()');
      await pool.query('DROP SEQUENCE qa_recovery_audit_reached');
    }
    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.userId, a.owner.id));
    await deniedWithoutWrites(a, body(a, a.marker + " after revocation"), 403,
      "revoked original employer membership");

    // Verify every real state contains exactly its own named scenarios only.
    for (const e of employers) {
      const own = await state(e.org.id);
      for (const scenario of own.scenarios) {
        assert.equal(scenario.organizationId, e.org.id);
        assert.ok(scenario.name.includes(e.marker),
          "scenario from another employer was persisted in this workspace");
      }
      for (const event of own.audits) {
        assert.equal(event.organizationId, e.org.id);
        assert.ok(!event.resource?.includes(victim.marker) || e === victim,
          "attacker audit must not disclose the victim marker");
      }
    }
    assert.equal(createdOwn, 7, "no positive HTTP assertions may be skipped");
    assert.equal(denied, 12, "both attackers, real victim, absent IDs and revocation must be tested");
    assert.equal(immutableVersions, 2);
    const result={
      family: "WPS-01", method: WPS01_METHOD, fictionalEmployers: 3,
      realOwnedHttpWrites: createdOwn, realDeniedHttpCalls: denied,
      separateAttackerOwners: 2, persistedHigherIdVictim: true,
      nonexistentVsForeignScopeIndistinguishable: true,
      scenarioVersionHistoryImmutable: true,
      auditVetoRollbacks:auditRollbacks, scenarioDiscriminators:createdOwn,
      revokedMembershipDenied: true, allVictimRowsUnchanged: true,
      payrollMutations: 0, providerCalls: 0, productionTested: false,
      newCoverageCredits: 0, independentSecurityReview: "PENDING",
    };
    recoveryReceipt('scenarios',result);
    console.log("WPS01_REAL_HTTP " + JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-wps01-scenarios-http.mjs")) {
  proveWps01Scenarios().catch(error => {
    console.error("WPS01_PROOF_FAILED", String(error?.stack ?? error));
    process.exitCode = 1;
  });
}
