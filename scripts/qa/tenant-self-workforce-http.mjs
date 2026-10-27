/**
 * Actual synthetic PostgreSQL 16 / production-mode localhost HTTP proof for
 * GET + POST /api/self/workforce. Session-bound employee data only; no money,
 * approval, punch application, provider calls, or tenant manifest credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableSelfWorkforce, assertNoPrivateMarker,
  assertWorkforceOwnRead, assertOwnCorrectionMutation,
  SELF_WORKFORCE_DATE, ORIGINAL_IN, ORIGINAL_OUT, PROPOSED_IN,
} from "./tenant-self-workforce-contract.mjs";

const ENDPOINT = "/api/self/workforce";
const DATE_QUERY = "?startDate=" + SELF_WORKFORCE_DATE + "&endDate=" + SELF_WORKFORCE_DATE;

export async function proveSelfWorkforceHttp() {
  // Fail before importing application modules or connecting to any database.
  requireDisposableSelfWorkforce();
  const [{ db, pool }, schema, table, invariant, drizzle] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("drizzle-orm"),
  ]);
  const { organizations, employees, users, userOrganizations, sessions, timePunches,
    attendanceCorrectionRequests, auditEvents, payrollRuns, employeeScheduleAssignments,
    scheduleOverrides } = schema;
  const { seedEmployer, addWorker, standaloneMakeSession, standaloneRequest,
    standaloneExpectStatus, victimSnapshot } = table;
  const { eq, asc } = drizzle;
  const marker = randomUUID().replaceAll("-", "").slice(0, 10);
  const rows = (tbl, orgId) => db.select().from(tbl)
    .where(eq(tbl.organizationId, orgId)).orderBy(asc(tbl.id));
  const snapshot = async (orgId) => {
    const [punches, corrections, staff, schedules, overrides, payroll, audits] = await Promise.all([
      rows(timePunches, orgId), rows(attendanceCorrectionRequests, orgId),
      rows(employees, orgId), rows(employeeScheduleAssignments, orgId),
      rows(scheduleOverrides, orgId), rows(payrollRuns, orgId),
      rows(auditEvents, orgId),
    ]);
    return { punches, corrections, employees: staff, schedules, overrides, payroll,
      audit: invariant.auditBusinessSnapshot(audits) };
  };
  const punchValues = (e, label, shiftMinutes = 0) => ({
    organizationId: e.org.id, employeeId: label.id, workDate: SELF_WORKFORCE_DATE,
    timeIn: new Date(Date.parse(ORIGINAL_IN) + shiftMinutes * 60000),
    timeOut: new Date(Date.parse(ORIGINAL_OUT) + shiftMinutes * 60000),
    status: "Complete", notes: label.employeeNo + " fictional private time record",
  });
  const correctionValues = (e, worker, punch, reason, requestedBy) => ({
    organizationId: e.org.id, employeeId: worker.id, punchId: punch.id,
    workDate: SELF_WORKFORCE_DATE,
    originalPunchSnapshot: { workDate: SELF_WORKFORCE_DATE,
      timeIn: punch.timeIn.toISOString(), timeOut: punch.timeOut.toISOString(),
      breakStart: null, breakEnd: null, status: "Complete" },
    proposedPunchSnapshot: { workDate: SELF_WORKFORCE_DATE,
      timeIn: new Date(punch.timeIn.getTime() - 15 * 60000).toISOString(),
      timeOut: punch.timeOut.toISOString(), breakStart: null, breakEnd: null,
      status: "Complete" },
    reason, status: "pending", requestedBy,
  });
  async function seed(label) {
    const e = await seedEmployer(label, marker, standaloneMakeSession);
    const [ess] = await db.insert(users).values({
      email: (e.marker + "-self-workforce@example.invalid").toLowerCase(),
      name: e.marker + " fictional ESS employee", role: "employee",
      employeeId: e.worker.id, passwordHash: "fictional-not-a-real-password",
      active: true, totpEnabled: true,
    }).returning();
    await db.insert(userOrganizations).values({ organizationId: e.org.id,
      userId: ess.id, role: "employee", workerEmployeeId: e.worker.id, active: true });
    const session = await standaloneMakeSession(ess.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, session.id));
    const [punch] = await db.insert(timePunches).values(punchValues(e, e.worker)).returning();
    const peer = await addWorker(e, "PEER", { payProfile: false });
    const [peerPunch] = await db.insert(timePunches)
      .values(punchValues(e, peer, 60)).returning();
    const [peerCorrection] = await db.insert(attendanceCorrectionRequests).values(
      correctionValues(e, peer, peerPunch, e.marker + "-PEER PRIVATE correction", "Fictional peer"),
    ).returning();
    let victimCorrection = null;
    if (label === "VICTIM") {
      [victimCorrection] = await db.insert(attendanceCorrectionRequests).values(
        correctionValues(e, e.worker, punch, e.marker + " PRIVATE victim correction", ess.name),
      ).returning();
    }
    return { ...e, ess, selfCookie: session.cookie, punch, peer, peerPunch,
      peerCorrection, victimCorrection,
      reason: e.marker + " fictional request to correct the attendance punch" };
  }

  try {
    const present = await db.select({ id: organizations.id }).from(organizations).limit(1);
    assert.equal(present.length, 0,
      "ESS_WORKFORCE_REFUSED: the disposable PG16 database must be empty before seeding");

    // Seed attacker A and B *including their peer punches* before the victim,
    // so every actual victim employer/worker/punch ID is greater.
    const first = await seed("ATTA");
    const second = await seed("ATTB");
    const victim = await seed("VICTIM");
    const attackers = [first, second];
    for (const a of attackers) {
      assert.ok(victim.org.id > a.org.id, "victim employer ID must be higher");
      assert.ok(victim.worker.id > a.peer.id, "victim employee ID must be higher than attacker peers");
      assert.ok(victim.punch.id > a.peerPunch.id, "victim punch ID must be genuine and higher");
      assert.notEqual(a.selfCookie, victim.selfCookie);
    }
    assert.notEqual(first.selfCookie, second.selfCookie,
      "two independently authenticated employee attacker sessions required");

    const victimBefore = await snapshot(victim.org.id);
    const victimCoreBefore = await victimSnapshot(victim.org.id);
    assert.equal(victimBefore.punches.length, 2);
    assert.equal(victimBefore.corrections.length, 2);
    const request = (path, options) => standaloneRequest(path, options);
    async function checked(path, options, status, label, actor) {
      const response = standaloneExpectStatus(await request(path, options), status, label);
      if (actor !== victim) assertNoPrivateMarker(response, victim.marker);
      return response;
    }
    async function denied(path, options, status, label, actor, baseline) {
      const result = await checked(path, options, status, label, actor);
      if (actor) {
        assertNoPrivateMarker(result, actor.marker + "-PEER PRIVATE");
        assert.deepEqual(await snapshot(actor.org.id), baseline,
          label + ": denied request must leave the attacker's own tenant unchanged");
      }
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        label + ": all victim workforce and payroll rows must remain unchanged");
      return result;
    }

    // The victim is real and its private time records are readable via only
    // its own employee login; anonymous and company-owner sessions cannot read ESS.
    const victimRead = await checked(ENDPOINT + DATE_QUERY,
      { cookie: victim.selfCookie }, 200, "victim's own populated GET", victim);
    assertWorkforceOwnRead(victimRead, victim, [victim.victimCorrection.id]);
    assert.deepEqual(await snapshot(victim.org.id), victimBefore, "victim GET does not write");

    await denied(ENDPOINT + DATE_QUERY, {}, 401, "anonymous GET", null, null);
    await denied(ENDPOINT, { method: "POST", body: {
      action: "request_correction", punchId: victim.punch.id,
      proposedTimeIn: PROPOSED_IN, reason: "Fictional unauthenticated correction",
    } }, 401, "anonymous POST", null, null);
    await denied(ENDPOINT + DATE_QUERY, { cookie: first.cookie }, 403,
      "company owner is not an employee self-service identity", first, await snapshot(first.org.id));
    await denied(ENDPOINT, { method: "POST", cookie: first.cookie, body: {
      action: "request_correction", punchId: first.punch.id, proposedTimeIn: PROPOSED_IN,
      reason: first.reason,
    } }, 403, "company owner cannot submit ESS corrections", first, await snapshot(first.org.id));

    let ownWrites = 0, forgedDenials = 0, ownReads = 0;
    for (const own of attackers) {
      const initial = await snapshot(own.org.id);
      assert.equal(initial.punches.length, 2, "both own and peer punch rows must actually exist");
      assert.equal(initial.corrections.length, 1, "a real peer correction must be present");
      const get = await checked(ENDPOINT + DATE_QUERY, { cookie: own.selfCookie },
        200, "employee reads only their own punch", own);
      assertWorkforceOwnRead(get, own);
      assertNoPrivateMarker(get, own.marker + "-PEER PRIVATE");
      ownReads++;

      // The route intentionally ignores caller-supplied employer and worker
      // selectors, deriving them exclusively from the signed-in ESS identity.
      for (const target of [victim.worker.id, own.peer.id]) {
        const forged = await checked(ENDPOINT + DATE_QUERY + "&organizationId=" +
          victim.org.id + "&employeeId=" + target, { cookie: own.selfCookie }, 200,
          "forged GET selectors must still return only session-owned records", own);
        assertWorkforceOwnRead(forged, own);
        assertNoPrivateMarker(forged, own.marker + "-PEER PRIVATE");
        assert.deepEqual(await snapshot(own.org.id), initial, "forged GET cannot write");
        assert.deepEqual(await snapshot(victim.org.id), victimBefore, "forged GET cannot change victim");
      }

      // Cross-tenant and same-employer other-employee punch identifiers must
      // deny rather than create a pending correction or expose the source data.
      for (const [target, foreign] of [[victim.punch.id, true], [own.peerPunch.id, false]]) {
        const forbidden = await denied(ENDPOINT, { method: "POST", cookie: own.selfCookie,
          body: { action: "request_correction", punchId: target, proposedTimeIn: PROPOSED_IN,
            organizationId: foreign ? victim.org.id : own.org.id,
            employeeId: foreign ? victim.worker.id : own.peer.id, reason: own.reason },
        }, 404, foreign ? "genuine foreign employer punch rejected" :
          "same-employer peer punch rejected", own, initial);
        if (!foreign) assertNoPrivateMarker(forbidden, own.marker + "-PEER PRIVATE");
        forgedDenials++;
      }

      const created = await checked(ENDPOINT, { method: "POST", cookie: own.selfCookie,
        body: { action: "request_correction", punchId: own.punch.id,
          proposedTimeIn: PROPOSED_IN, reason: own.reason },
      }, 201, "real owned punch requests an unapproved correction", own);
      const after = await snapshot(own.org.id);
      const correction = assertOwnCorrectionMutation(initial, after, own, created);
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "successful own request cannot touch victim records");
      assertNoPrivateMarker(created, victim.marker);
      ownWrites++;

      const readback = await checked(ENDPOINT + DATE_QUERY,
        { cookie: own.selfCookie }, 200, "real own pending correction readback", own);
      assertWorkforceOwnRead(readback, own, [correction.id]);
      assertNoPrivateMarker(readback, own.marker + "-PEER PRIVATE");
      const repeat = await denied(ENDPOINT, { method: "POST", cookie: own.selfCookie,
        body: { action: "request_correction", punchId: own.punch.id,
          proposedTimeIn: PROPOSED_IN, reason: own.reason },
      }, 409, "duplicate own correction refused", own, after);
      assertNoPrivateMarker(repeat, victim.marker);
    }

    assert.deepEqual(await snapshot(victim.org.id), victimBefore, "victim tenant exactly unchanged");
    assert.deepEqual(await victimSnapshot(victim.org.id), victimCoreBefore,
      "victim organization, workforce, legal entities, other scopes and audit unchanged");
    assert.equal(ownReads, 2);
    assert.equal(ownWrites, 2);
    assert.equal(forgedDenials, 4);
    console.log(JSON.stringify({
      kind: "tenant-self-workforce-http", methods: ["GET", "POST"],
      profiles: "default", fictionalEmployers: 3, independentEmployeeAttackers: 2,
      realHighIdVictim: true, actualOwnReadAndPendingWrite: true,
      sameEmployerPeerAndCrossEmployerPrivacy: true, forgedWriteDenials: forgedDenials,
      unchangedVictimDatabase: true, payrollApplied: false,
      productionTested: false, certified: false, coverageCreditsAdded: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-self-workforce-http.mjs")) {
  proveSelfWorkforceHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
