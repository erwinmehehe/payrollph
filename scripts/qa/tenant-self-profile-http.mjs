/**
 * Execute PATCH /api/self/profile through real signed-in employee cookies on a
 * disposable fictional PostgreSQL 16 / localhost production-mode Next server.
 * No employer data, payroll money, providers, migrations or coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableSelfProfile, assertNoProfileMarker,
  assertProfileDenied, assertOwnProfileMutation,
} from "./tenant-self-profile-contract.mjs";

const ENDPOINT = "/api/self/profile";

export async function proveSelfProfileHttp() {
  // Refuse unsafe configuration before importing anything that opens a DB pool.
  requireDisposableSelfProfile();
  const [{ db, pool }, schema, table, invariants, drizzle] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("drizzle-orm"),
  ]);
  const {
    organizations, legalEntities, orgUnits, employees, employeePayProfiles,
    users, userOrganizations, sessions, timePunches, payrollRuns, auditEvents,
  } = schema;
  const {
    seedEmployer, addWorker, standaloneMakeSession,
    standaloneRequest, standaloneExpectStatus, victimSnapshot,
  } = table;
  const { and, asc, eq } = drizzle;
  const marker = randomUUID().replaceAll("-", "").slice(0, 10);
  const organizationRows = (source, orgId) => db.select().from(source)
    .where(eq(source.organizationId, orgId)).orderBy(asc(source.id));
  const snapshot = async (orgId) => {
    const [staff, profiles, punches, payroll, units, entities, memberships, audit] =
      await Promise.all([
        organizationRows(employees, orgId),
        organizationRows(employeePayProfiles, orgId),
        organizationRows(timePunches, orgId),
        organizationRows(payrollRuns, orgId),
        organizationRows(orgUnits, orgId),
        organizationRows(legalEntities, orgId),
        organizationRows(userOrganizations, orgId),
        organizationRows(auditEvents, orgId),
      ]);
    return {
      employees: staff, payProfiles: profiles, punches, payroll,
      orgUnits: units, legalEntities: entities, memberships,
      audit: invariants.auditBusinessSnapshot(audit),
    };
  };
  const contact = (e, sequence = 1) => ({
    mobile: "09" + String(e.worker.id * 10 + sequence).padStart(9, "0"),
    emergencyContact: e.marker + "-OWN-CONTACT-" + sequence,
    emergencyPhone: "08" + String(e.worker.id * 10 + sequence).padStart(9, "0"),
  });

  async function seed(label) {
    const e = await seedEmployer(label, marker, standaloneMakeSession);
    const peer = await addWorker(e, "PEER");
    await db.update(employees).set({
      mobile: "09110000000",
      emergencyContact: e.marker + "-PEER-PRIVATE",
      emergencyPhone: "09220000000",
    }).where(and(eq(employees.id, peer.id), eq(employees.organizationId, e.org.id)));
    const [ess] = await db.insert(users).values({
      email: (e.marker + "-self-profile@example.invalid").toLowerCase(),
      name: e.marker + " fictional ESS employee", role: "employee",
      employeeId: e.worker.id, passwordHash: "fictional-not-a-real-password",
      active: true, totpEnabled: true,
    }).returning();
    await db.insert(userOrganizations).values({
      organizationId: e.org.id, userId: ess.id, role: "employee",
      workerEmployeeId: e.worker.id, active: true,
    });
    const session = await standaloneMakeSession(ess.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, session.id));
    return { ...e, peer, ess, selfCookie: session.cookie };
  }

  try {
    const present = await db.select({ id: organizations.id })
      .from(organizations).limit(1);
    assert.equal(present.length, 0,
      "ESS_PROFILE_REFUSED: PostgreSQL must have zero organizations before seeding");

    // Insert true high-ID victim last. Both independent employee attackers have
    // an own worker and a same-employer coworker with distinct private markers.
    const first = await seed("ATTA");
    const second = await seed("ATTB");
    const victim = await seed("VICTIM");
    const attackers = [first, second];
    for (const a of attackers) {
      assert.ok(victim.org.id > a.org.id, "victim employer must have a higher real ID");
      assert.ok(victim.worker.id > a.peer.id, "victim worker must have a higher real ID");
      assert.ok(a.worker.id > 0 && a.peer.id > a.worker.id);
      assert.notEqual(a.selfCookie, victim.selfCookie);
    }
    assert.notEqual(first.selfCookie, second.selfCookie,
      "two independent session cookies, not a reused authenticated identity");

    const send = (path, options) => standaloneRequest(path, options);
    const checked = async (path, options, status, label, actor) => {
      const response = standaloneExpectStatus(await send(path, options), status, label);
      if (actor !== victim) assertNoProfileMarker(response, victim.marker);
      if (actor) assertNoProfileMarker(response, actor.marker + "-PEER-PRIVATE");
      return response;
    };
    const victimSeeded = await snapshot(victim.org.id);
    assert.equal(victimSeeded.employees.length, 2);
    const victimOwnResponse = await checked(ENDPOINT, {
      method: "PATCH", cookie: victim.selfCookie, body: contact(victim),
    }, 200, "victim independently edits their own persisted contact", victim);
    const victimAfterOwn = await snapshot(victim.org.id);
    assertOwnProfileMutation(victimSeeded, victimAfterOwn, victim,
      victimOwnResponse, contact(victim));
    const victimBefore = await snapshot(victim.org.id);
    const victimCoreBefore = await victimSnapshot(victim.org.id);
    const unchangedVictim = async (label) => {
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        label + ": victim contacts, memberships, payroll and business audits unchanged");
      assert.deepEqual(await victimSnapshot(victim.org.id), victimCoreBefore,
        label + ": victim organization, legal entities and recovered source state unchanged");
    };

    // Nonemployee and unauthenticated callers cannot edit profile fields.
    for (const [label, options, status] of [
      ["anonymous PATCH", { method: "PATCH", body: contact(victim) }, 401],
      ["owner cannot act as employee", {
        method: "PATCH", cookie: first.cookie, body: contact(first),
      }, 403],
    ]) {
      const aBefore = await snapshot(first.org.id);
      const bBefore = await snapshot(second.org.id);
      const result = await checked(ENDPOINT, options, status, label, null);
      assertProfileDenied(result, status, [victim.marker, first.marker + "-PEER-PRIVATE"]);
      assert.deepEqual(await snapshot(first.org.id), aBefore, label + ": A unchanged");
      assert.deepEqual(await snapshot(second.org.id), bBefore, label + ": B unchanged");
      await unchangedVictim(label);
    }

    let ownSuccesses = 0, forgedSelectors = 0, blockedWrites = 0;
    for (const own of attackers) {
      assert.equal((await snapshot(own.org.id)).employees.length, 2);
      // Disallowed payroll, government and tenant fields cannot form a contact edit.
      const beforeForbidden = await snapshot(own.org.id);
      const forbidden = await checked(ENDPOINT, {
        method: "PATCH", cookie: own.selfCookie,
        body: {
          employeeId: victim.worker.id, organizationId: victim.org.id,
          basicRate: "9999999", bankAccount: "FAKE", tin: "000000000",
        },
      }, 400, "noneditable-only payload refused", own);
      assertProfileDenied(forbidden, 400, [victim.marker, own.marker + "-PEER-PRIVATE"]);
      assert.deepEqual(await snapshot(own.org.id), beforeForbidden,
        "forged payroll or account fields cannot alter own records or audit");
      await unchangedVictim("restricted-field denial");
      blockedWrites++;

      const firstBefore = await snapshot(own.org.id);
      const actual = await checked(ENDPOINT, {
        method: "PATCH", cookie: own.selfCookie, body: contact(own, 1),
      }, 200, "own contact PATCH", own);
      const firstAfter = await snapshot(own.org.id);
      assertOwnProfileMutation(firstBefore, firstAfter, own, actual, contact(own, 1));
      assert.deepEqual(firstAfter.memberships, firstBefore.memberships);
      await unchangedVictim("own contact write");
      ownSuccesses++;

      // The route ignores caller-supplied worker/tenant selectors, but must still
      // update the authenticated employee and NEVER the real high-ID victim.
      const forgedBefore = await snapshot(own.org.id);
      const forged = await checked(ENDPOINT + "?organizationId=" + victim.org.id
        + "&employeeId=" + victim.worker.id, {
        method: "PATCH", cookie: own.selfCookie,
        body: {
          ...contact(own, 2), organizationId: victim.org.id,
          employeeId: victim.worker.id,
        },
      }, 200, "foreign worker selectors may not change effective identity", own);
      const forgedAfter = await snapshot(own.org.id);
      assertOwnProfileMutation(forgedBefore, forgedAfter, own, forged, contact(own, 2));
      assert.deepEqual(forgedAfter.memberships, forgedBefore.memberships);
      await unchangedVictim("foreign forged selector");
      ownSuccesses++; forgedSelectors++;

      const peerBefore = await snapshot(own.org.id);
      const peerForged = await checked(ENDPOINT + "?employeeId=" + own.peer.id, {
        method: "PATCH", cookie: own.selfCookie,
        body: {
          ...contact(own, 3), organizationId: own.org.id, employeeId: own.peer.id,
        },
      }, 200, "coworker selectors may not change effective identity", own);
      const peerAfter = await snapshot(own.org.id);
      assertOwnProfileMutation(peerBefore, peerAfter, own, peerForged, contact(own, 3));
      assert.deepEqual(peerAfter.memberships, peerBefore.memberships);
      await unchangedVictim("same-company coworker forged selector");
      ownSuccesses++; forgedSelectors++;
    }

    // An active grant to this employer cannot point at a different employee.
    // This is a real, same-tenant identity-binding case, not a fabricated ID.
    const [boundMembership] = await db.select({ id: userOrganizations.id })
      .from(userOrganizations).where(and(
        eq(userOrganizations.userId, first.ess.id),
        eq(userOrganizations.organizationId, first.org.id),
      )).limit(1);
    assert.ok(boundMembership?.id);
    await db.update(userOrganizations).set({ workerEmployeeId: first.peer.id })
      .where(eq(userOrganizations.id, boundMembership.id));
    const mismatchBefore = await snapshot(first.org.id);
    const otherBeforeMismatch = await snapshot(second.org.id);
    const mismatch = await checked(ENDPOINT, {
      method: "PATCH", cookie: first.selfCookie, body: contact(first, 8),
    }, 403, "employee link mismatches same-company active membership", first);
    assertProfileDenied(mismatch, 403, [victim.marker, first.marker + "-PEER-PRIVATE"]);
    assert.deepEqual(await snapshot(first.org.id), mismatchBefore,
      "incorrect worker binding cannot edit own or peer contact or create an audit");
    assert.deepEqual(await snapshot(second.org.id), otherBeforeMismatch,
      "mismatched worker grant cannot affect other employer");
    await unchangedVictim("same-company identity mismatch");
    blockedWrites++;
    await db.update(userOrganizations).set({ workerEmployeeId: first.worker.id })
      .where(eq(userOrganizations.id, boundMembership.id));

    // Deliberately make ONLY the disposable DB reject this audit action.
    // If the profile UPDATE commits independently of its audit, the protected
    // before/after employee snapshot below fails, proving atomic rollback.
    await pool.query(`
      CREATE FUNCTION ci_self_profile_reject_audit() RETURNS trigger
      LANGUAGE plpgsql AS $
      BEGIN
        IF NEW.action = 'Employee self-service profile updated' THEN
          RAISE EXCEPTION 'synthetic self-profile audit veto';
        END IF;
        RETURN NEW;
      END;
      $
    `);
    await pool.query(`
      CREATE TRIGGER ci_self_profile_reject_audit
      BEFORE INSERT ON audit_events FOR EACH ROW
      EXECUTE FUNCTION ci_self_profile_reject_audit()
    `);
    try {
      const beforeAuditVeto = await snapshot(first.org.id);
      const otherBeforeAuditVeto = await snapshot(second.org.id);
      const auditVeto = await checked(ENDPOINT, {
        method: "PATCH", cookie: first.selfCookie, body: contact(first, 9),
      }, 500, "injected audit rejection must roll back the contact write", first);
      assertNoProfileMarker(auditVeto, victim.marker);
      assert.deepEqual(await snapshot(first.org.id), beforeAuditVeto,
        "failed audit transaction cannot commit an unaudited contact change");
      assert.deepEqual(await snapshot(second.org.id), otherBeforeAuditVeto,
        "audit veto must not touch any different employer");
      await unchangedVictim("disposable audit veto");
      blockedWrites++;
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS ci_self_profile_reject_audit ON audit_events");
      await pool.query("DROP FUNCTION IF EXISTS ci_self_profile_reject_audit()");
    }

    // Revocation is tested with the SAME real session after its owner remains
    // an active employee member in B. The linked employee remains in A.
    await db.insert(userOrganizations).values({
      organizationId: second.org.id,
      userId: first.ess.id,
      role: "employee",
      workerEmployeeId: second.peer.id,
      active: true,
    });
    await db.update(userOrganizations).set({ active: false }).where(and(
      eq(userOrganizations.organizationId, first.org.id),
      eq(userOrganizations.userId, first.ess.id),
    ));
    const aRevoked = await snapshot(first.org.id);
    const bGranted = await snapshot(second.org.id);
    const revoked = await checked(ENDPOINT + "?organizationId=" + second.org.id, {
      method: "PATCH", cookie: first.selfCookie,
      body: { ...contact(first, 4), organizationId: second.org.id,
        employeeId: second.worker.id },
    }, 403, "reused session denied after original employer membership revocation", first);
    assertProfileDenied(revoked, 403, [victim.marker, second.marker, first.marker + "-PEER-PRIVATE"]);
    assert.deepEqual(await snapshot(first.org.id), aRevoked,
      "revoked employer contacts and audits cannot change");
    assert.deepEqual(await snapshot(second.org.id), bGranted,
      "other authorized employer contacts and audits cannot change");
    await unchangedVictim("membership revoked while another grant remains");
    blockedWrites++;

    await db.update(userOrganizations).set({ active: true }).where(and(
      eq(userOrganizations.organizationId, first.org.id),
      eq(userOrganizations.userId, first.ess.id),
    ));
    const aRestored = await snapshot(first.org.id);
    const restored = await checked(ENDPOINT, {
      method: "PATCH", cookie: first.selfCookie, body: contact(first, 5),
    }, 200, "restored active membership can update own contact again", first);
    const aAfterRestore = await snapshot(first.org.id);
    assertOwnProfileMutation(aRestored, aAfterRestore, first, restored, contact(first, 5));
    assert.deepEqual(aAfterRestore.memberships, aRestored.memberships);
    await unchangedVictim("restored own access");
    ownSuccesses++;

    assert.equal(ownSuccesses, 7);
    assert.equal(forgedSelectors, 4);
    assert.equal(blockedWrites, 5);
    console.log(JSON.stringify({
      kind: "tenant-self-profile-patch", method: "PATCH /api/self/profile",
      fictionalEmployers: 3, distinctEmployeeAttackers: 2,
      realHighIdVictim: true, genuineOwnContactMutations: ownSuccesses,
      forgedSelectorOwnOnly: forgedSelectors, deniedNoMutation: blockedWrites + 2,
      activeOtherMembershipAfterRevocation: true,
      noVictimPeerPayrollOrAuditLeak: true,
      workerIdentityMismatchDenied: true, profileAuditRollbackProven: true,
      productionTested: false, deploymentApproved: false,
      certified: false, coverageCreditsAdded: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("scripts/qa/tenant-self-profile-http.mjs")) {
  proveSelfProfileHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
