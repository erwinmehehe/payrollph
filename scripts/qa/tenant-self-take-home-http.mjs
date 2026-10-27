/**
 * Isolated employee-only GET /api/self/take-home-estimate proof.
 * Runs against disposable localhost PostgreSQL 16 and real production-mode
 * Next HTTP. NO production DB, financial changes, provider or coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  TAKE_HOME_RATES, requireDisposableTakeHome,
  assertOwnTakeHome, assertTakeHomeDenied,
} from "./tenant-self-take-home-contract.mjs";

const ENDPOINT = "/api/self/take-home-estimate";

export async function proveSelfTakeHomeHttp() {
  // Verify every sensitive execution precondition BEFORE any application imports.
  requireDisposableTakeHome();
  const [{ db, pool }, schema, table, invariants, drizzle] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("drizzle-orm"),
  ]);
  const { organizations, employees, employeePayProfiles, payrollRuns, auditEvents,
    users, userOrganizations, sessions } = schema;
  const { eq, asc } = drizzle;
  const { seedEmployer, addWorker, standaloneMakeSession,
    standaloneRequest, standaloneExpectStatus, victimSnapshot,
    requireTenantTableDisposable } = table;
  const { auditBusinessSnapshot } = invariants;
  const randomNonce = randomUUID().replaceAll("-", "").slice(0, 10);

  const rows = (source, orgId) => db.select().from(source)
    .where(eq(source.organizationId, orgId)).orderBy(asc(source.id));
  const state = async (orgId) => ({
    employees: await rows(employees, orgId),
    payProfiles: await rows(employeePayProfiles, orgId),
    payroll: await rows(payrollRuns, orgId),
    audit: auditBusinessSnapshot(await rows(auditEvents, orgId)),
  });
  async function employeeSession(e, worker, label) {
    const [user] = await db.insert(users).values({
      email: (e.marker + "-" + label + "@example.invalid").toLowerCase(),
      name: e.marker + " fictional " + label,
      role: "employee", employeeId: worker?.id ?? null,
      passwordHash: "fictional-not-a-real-password",
      active: true, totpEnabled: true,
    }).returning();
    await db.insert(userOrganizations).values({
      organizationId: e.org.id, userId: user.id, role: "employee",
      workerEmployeeId: worker?.id ?? null, active: true,
    });
    const session = await standaloneMakeSession(user.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, session.id));
    return { user, cookie: session.cookie };
  }

  async function seed(label) {
    const e = await seedEmployer(label, randomNonce, standaloneMakeSession);
    const rate = TAKE_HOME_RATES[label];
    assert.ok(rate, "synthetic salary must be explicitly pinned");
    await db.update(employees).set({ basicRate: rate })
      .where(eq(employees.id, e.worker.id));
    await db.update(employeePayProfiles).set({ rateAmount: rate })
      .where(eq(employeePayProfiles.employeeId, e.worker.id));
    const peer = await addWorker(e, "PEER");
    await db.update(employees).set({ basicRate: TAKE_HOME_RATES.PEER })
      .where(eq(employees.id, peer.id));
    await db.update(employeePayProfiles).set({ rateAmount: TAKE_HOME_RATES.PEER })
      .where(eq(employeePayProfiles.employeeId, peer.id));
    const ownEss = await employeeSession(e, e.worker, "ESS");
    const peerEss = await employeeSession(e, peer, "PEER-ESS");
    return { ...e, rate, peer, ownEss, peerEss };
  }

  async function get(cookie, query = "") {
    assert.ok(query === "" || query.startsWith("?"),
      "only read-only take-home query strings allowed");
    return standaloneRequest(ENDPOINT + query, { cookie });
  }

  try {
    requireTenantTableDisposable();
    assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length,
      0, "TAKE_HOME_REFUSED: only an empty disposable PG16 employer database");
    const first = await seed("ATTA");
    const second = await seed("ATTB");
    const victim = await seed("VICTIM");

    for (const own of [first, second]) {
      assert.ok(victim.org.id > own.org.id);
      assert.ok(victim.worker.id > own.peer.id);
      assert.ok(victim.ownEss.user.id > own.ownEss.user.id);
      assert.notEqual(own.ownEss.cookie, victim.ownEss.cookie);
    }
    assert.notEqual(first.ownEss.cookie, second.ownEss.cookie);
    assert.notEqual(first.peerEss.cookie, first.ownEss.cookie);
    const [unlinked] = await db.insert(users).values({
      email: "unlinked-" + randomNonce + "@example.invalid",
      name: "Fictional employee without binding", role: "employee",
      employeeId: null, passwordHash: "fictional-not-a-real-password", active: true,
    }).returning();
    await db.insert(userOrganizations).values({
      userId: unlinked.id, organizationId: first.org.id,
      role: "employee", active: true,
    });
    const unlinkedSession = await standaloneMakeSession(unlinked.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, unlinkedSession.id));

    // Invalid legacy identity: an A-only account points to C's *real*
    // employee row. The actual membership check must deny C's private pay.
    const [forged] = await db.insert(users).values({
      email: "forged-" + randomNonce + "@example.invalid",
      name: "Fictional cross-employer employee binding",
      role: "employee", employeeId: victim.worker.id,
      passwordHash: "fictional-not-a-real-password", active: true,
    }).returning();
    await db.insert(userOrganizations).values({
      userId: forged.id, organizationId: first.org.id,
      role: "employee", active: true,
    });
    const forgedSession = await standaloneMakeSession(forged.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, forgedSession.id));

    const before = new Map();
    for (const e of [first, second, victim]) before.set(e.org.id, await state(e.org.id));
    const victimCore = await victimSnapshot(victim.org.id);
    assert.equal(before.get(victim.org.id).payProfiles.length, 2);
    assert.equal(before.get(victim.org.id).payroll.length, 0);

    // A legitimate higher-ID victim must receive its own *populated* salary,
    // so empty-success or fabricated 200 probes cannot pass this fixture.
    const victimReply = standaloneExpectStatus(await get(victim.ownEss.cookie),
      200, "higher-ID victim's own private take-home estimate");
    assertOwnTakeHome(victimReply, victim.rate,
      [first.rate, second.rate, TAKE_HOME_RATES.PEER]);

    assertTakeHomeDenied(await get(), 401, [victim.rate]);
    assertTakeHomeDenied(await get(first.cookie), 403, [first.rate, victim.rate]);
    assertTakeHomeDenied(await get(unlinkedSession.cookie), 403, [victim.rate]);
    assertTakeHomeDenied(await get(forgedSession.cookie), 403, [victim.rate]);
    let ownPositives = 0, peerPositives = 0, forgedSelectors = 0;
    for (const [own, other] of [[first, second], [second, first]]) {
      const ownReply = standaloneExpectStatus(await get(own.ownEss.cookie),
        200, "real employee reads its own employer's rate");
      assertOwnTakeHome(ownReply, own.rate,
        [victim.rate, other.rate, TAKE_HOME_RATES.PEER]);
      assert.throws(() => assertOwnTakeHome(ownReply, other.rate),
        "A's salary response must fail B's positive assertion");
      ownPositives++;

      const peerReply = standaloneExpectStatus(await get(own.peerEss.cookie),
        200, "same-employer colleague reads its different own rate");
      assertOwnTakeHome(peerReply, TAKE_HOME_RATES.PEER,
        [own.rate, other.rate, victim.rate]);
      peerPositives++;

      // No employer/employee/user/legal-entity query selector may redirect
      // this strictly session-bound employee salary read to C or a colleague.
      for (const query of [
        "?organizationId=" + victim.org.id + "&employeeId=" + victim.worker.id +
          "&userId=" + victim.ownEss.user.id + "&legalEntityId=" + victim.entity.id,
        "?organizationId=" + own.org.id + "&employeeId=" + own.peer.id,
      ]) {
        const response = standaloneExpectStatus(await get(own.ownEss.cookie, query),
          200, "forged selector still returns signed-in employee's own pay only");
        assertOwnTakeHome(response, own.rate,
          [victim.rate, other.rate, TAKE_HOME_RATES.PEER]);
        forgedSelectors++;
      }
      assert.deepEqual(await state(own.org.id), before.get(own.org.id),
        "all employee, salary profile, payroll and audit records must be unchanged by GET");
      assert.deepEqual(await state(victim.org.id), before.get(victim.org.id),
        "all victim salary and payroll records must remain unchanged");
    }

    // Membership removal must invalidate access even for an existing
    // otherwise-unexpired employee session; no amount may be returned.
    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.userId, first.ownEss.user.id));
    const revoked = await get(first.ownEss.cookie);
    assertTakeHomeDenied(revoked, 403, [first.rate, victim.rate]);
    assert.deepEqual(await state(first.org.id), before.get(first.org.id),
      "revoking membership cannot edit recorded salary or payroll");
    assert.deepEqual(await state(second.org.id), before.get(second.org.id));
    assert.deepEqual(await state(victim.org.id), before.get(victim.org.id));
    assert.deepEqual(await victimSnapshot(victim.org.id), victimCore,
      "higher-ID victim's employee, entity, audit and recovered sources unchanged");
    assert.equal(ownPositives, 2);
    assert.equal(peerPositives, 2);
    assert.equal(forgedSelectors, 4);

    console.log(JSON.stringify({
      kind: "tenant-self-take-home-http", method: "GET self/take-home-estimate",
      fictionalEmployers: 3, signedInEmployeeAttackers: 2,
      populatedVictimPositive: true, sameEmployerPeerPositive: peerPositives,
      forcedSelectorStaysOwn: forgedSelectors, ownerAndAnonymousDenied: true,
      invalidIdentityAndRevokedMembershipDenied: true,
      victimRowsUnchanged: true, payrollMutation: false,
      productionTested: false, certified: false, coverageCreditsAdded: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-self-take-home-http.mjs")) {
  proveSelfTakeHomeHttp().then(() => process.exit(0), (error) => {
    console.error(error);
    process.exit(1);
  });
}
