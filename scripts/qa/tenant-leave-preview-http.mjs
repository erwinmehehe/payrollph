// Stronger read-only POST leave-preview proof; disposable PG16 + real Next HTTP.
// Never submits leave, approves schedules, pays workers, or contacts providers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableLeavePreview as requirePriorGuard } from "./tenant-leave-preview-guard.mjs";
import {
  LEAVE_DATE, shiftFor, requireDisposableLeavePreview,
  fullDayPreviewBody, proveActualLeavePreview, proveLeavePreviewDenial,
  assertLeavePreviewSourcesEqual,
} from "./tenant-leave-preview-contract.mjs";

export async function verifyLeavePreviewTenantHttp() {
  requirePriorGuard();
  requireDisposableLeavePreview(); // before importing any app/database code
  const [{ db, pool }, schema, { eq, asc }, shared, { auditBusinessSnapshot }] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const {
    organizations, users, sessions, userOrganizations, employees,
    shiftDefinitions, scheduleOverrides, leaveRequests, leaveBalances,
    payrollRuns, employeePayProfiles, auditEvents,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest, victimSnapshot } = shared;
  try {
    assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length,
      0, "LEAVE_PREVIEW_REFUSED: fresh disposable DB with zero employers required");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).limit(1)).length,
      0, "LEAVE_PREVIEW_REFUSED: disposable audit must start empty");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    for (const field of ["org", "worker", "unit", "entity", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "higher-ID victim must be a genuine database row: " + field);
    }

    async function seedScheduledWorker(e, worker, marker, rank) {
      const config = shiftFor(rank);
      const code = (marker + "-SH").slice(0, 32);
      const shiftName = marker + " fictional shift";
      const [shift] = await db.insert(shiftDefinitions).values({
        organizationId: e.org.id, code, name: shiftName,
        startTime: config.start, endTime: config.end,
        breakMinutes: config.breakMinutes, spansMidnight: false, active: true,
      }).returning();
      const [override] = await db.insert(scheduleOverrides).values({
        organizationId: e.org.id, employeeId: worker.id,
        workDate: LEAVE_DATE, kind: "shift", status: "approved",
        isRestDay: false, segments: [{ shiftDefinitionId: shift.id, segmentOrder: 1 }],
        workLocationOrgUnitId: e.unit.id, worksiteId: null,
        reason: marker + " fictional approved source fixture only",
        createdBy: "Disposable QA", approvedBy: "Disposable QA",
        approvedAt: new Date("2026-10-25T00:00:00.000Z"),
      }).returning();
      assert.ok(shift.id > 0 && override.id > 0);
      assert.equal(shift.organizationId, e.org.id);
      assert.equal(override.organizationId, e.org.id);
      assert.equal(override.employeeId, worker.id);
      return { org: e.org, unit: e.unit, worker, marker, rank, shift, override, cookie: e.cookie };
    }
    // IDs genuinely increase because every INSERT is awaited in tenant order.
    const attackerA = await seedScheduledWorker(a, a.worker, a.marker, 1);
    const attackerB = await seedScheduledWorker(b, b.worker, b.marker, 2);
    const target = await seedScheduledWorker(victim, victim.worker, victim.marker, 4);
    assert.ok(target.shift.id > attackerA.shift.id && target.shift.id > attackerB.shift.id);
    assert.ok(target.override.id > attackerA.override.id && target.override.id > attackerB.override.id);

    // Peer is a real different employee in A's *same* employer, not a
    // second employer pretending to be a peer. Its marker is disjoint.
    const peerMarker = "TTBL-PEER-" + nonce;
    const [peerWorker] = await db.insert(employees).values({
      organizationId: a.org.id, legalEntityId: a.entity.id, orgUnitId: a.unit.id,
      employeeNo: peerMarker, firstName: "Fictional", lastName: peerMarker,
      title: "Fictional", avatarInitials: "TT", basicRate: "22000.00",
      startDate: "2026-01-05",
    }).returning();
    const peer = await seedScheduledWorker(a, peerWorker, peerMarker, 3);
    assert.notEqual(peer.worker.id, attackerA.worker.id);

    async function employeeSession(e) {
      const [user] = await db.insert(users).values({
        email: "leave-preview-" + e.marker.toLowerCase() + "@example.invalid",
        name: "Fictional self " + e.marker, role: "employee",
        employeeId: e.worker.id, passwordHash: "synthetic-only-no-login",
        localPasswordEnabled: false, active: true,
      }).returning();
      await db.insert(userOrganizations).values({
        userId: user.id, organizationId: e.org.id, role: "employee",
        workerEmployeeId: e.worker.id, active: true,
      });
      const session = await standaloneMakeSession(user.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const employeeA = await employeeSession(attackerA);
    const employeePeer = await employeeSession(peer);
    assert.notEqual(employeeA.user.id, employeePeer.user.id);
    assert.notEqual(employeeA.user.employeeId, employeePeer.user.employeeId);

    const [separated] = await db.insert(employees).values({
      organizationId: a.org.id, legalEntityId: a.entity.id, orgUnitId: a.unit.id,
      employeeNo: a.marker + "-EXIT", firstName: "Fictional",
      lastName: a.marker + "-EXIT", title: "Fictional",
      avatarInitials: "TT", basicRate: "19000.00", startDate: "2026-01-05",
      status: "Separated",
    }).returning();

    const allMarkers = [a.marker, b.marker, victim.marker, peerMarker, separated.employeeNo];
    const forbiddenFor = e => allMarkers.filter(marker =>
      marker !== e.marker && !e.marker.startsWith(marker));
    const expected = e => ({
      workerId: e.worker.id, employeeNo: e.worker.employeeNo,
      employeeName: e.worker.firstName + " " + e.worker.lastName,
      unitId: e.unit.id, rank: e.rank, shiftId: e.shift.id,
      shiftCode: e.shift.code, shiftName: e.shift.name,
      overrideId: e.override.id, forbiddenMarkers: forbiddenFor(e),
    });
    async function snapshot(e) {
      const rows = table => db.select().from(table)
        .where(eq(table.organizationId, e.org.id)).orderBy(asc(table.id));
      const [staff, shifts, overrides, leaves, balances, runs, payProfiles, rawAudit] =
        await Promise.all([
          rows(employees), rows(shiftDefinitions), rows(scheduleOverrides),
          rows(leaveRequests), rows(leaveBalances), rows(payrollRuns),
          rows(employeePayProfiles), rows(auditEvents),
        ]);
      return { staff, shifts, overrides, leaves, balances, runs, payProfiles,
        audit: auditBusinessSnapshot(rawAudit) };
    }
    const before = new Map();
    for (const e of [a, b, victim]) before.set(e.org.id, await snapshot(e));
    const victimBefore = await victimSnapshot(victim.org.id);

    async function call(cookie, body, crossSite = false) {
      if (!crossSite) {
        return standaloneRequest("/api/leave/preview", { method: "POST", cookie, body });
      }
      const response = await fetch("http://127.0.0.1:3000/api/leave/preview", {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: {
          cookie, "content-type": "application/json",
          origin: "https://hostile.example.invalid", "sec-fetch-site": "cross-site",
        }, body: JSON.stringify(body),
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json, headers: response.headers };
    }
    let positives = 0, denials = 0, ignoredSpoofs = 0;
    async function positive(cookie, body, subject) {
      const response = await call(cookie, body);
      proveActualLeavePreview(response, expected(subject));
      positives++;
      return response;
    }
    async function denied(cookie, body, status, crossSite = false) {
      const response = await call(cookie, body, crossSite);
      proveLeavePreviewDenial(response, status, allMarkers);
      denials++;
    }

    const ownA = await positive(a.cookie, fullDayPreviewBody(a.org.id, a.worker.id), attackerA);
    const ownB = await positive(b.cookie, fullDayPreviewBody(b.org.id, b.worker.id), attackerB);
    await positive(victim.cookie, fullDayPreviewBody(victim.org.id, victim.worker.id), target);
    assert.throws(() => proveActualLeavePreview(ownA, expected(attackerB)),
      "attacker-A schedule must not satisfy attacker-B proof");
    assert.throws(() => proveActualLeavePreview(ownB, expected(attackerA)),
      "attacker-B schedule must not satisfy attacker-A proof");

    for (const own of [attackerA, attackerB]) {
      const other = own === attackerA ? attackerB : attackerA;
      await denied(own.cookie, fullDayPreviewBody(victim.org.id, victim.worker.id), 403);
      await denied(own.cookie, fullDayPreviewBody(own.org.id, victim.worker.id), 404);
      await denied(own.cookie, fullDayPreviewBody(own.org.id, other.worker.id), 404);
    }

    await positive(a.cookie, fullDayPreviewBody(a.org.id, peer.worker.id), peer);
    await positive(employeeA.cookie, fullDayPreviewBody(a.org.id, a.worker.id), attackerA);
    await positive(employeePeer.cookie, fullDayPreviewBody(a.org.id, peer.worker.id), peer);
    // Employee-role requests must always ignore a forged employeeId, even when
    // it names a real higher-ID victim or a peer in the same organization.
    await positive(employeeA.cookie, fullDayPreviewBody(a.org.id, peer.worker.id), attackerA);
    ignoredSpoofs++;
    await positive(employeeA.cookie, fullDayPreviewBody(a.org.id, victim.worker.id), attackerA);
    ignoredSpoofs++;
    await positive(employeePeer.cookie, fullDayPreviewBody(a.org.id, a.worker.id), peer);
    ignoredSpoofs++;
    await denied(employeeA.cookie, fullDayPreviewBody(victim.org.id, victim.worker.id), 403);
    await denied(employeePeer.cookie, fullDayPreviewBody(victim.org.id, victim.worker.id), 403);

    await denied(undefined, fullDayPreviewBody(a.org.id, a.worker.id), 401);
    await denied(a.cookie, fullDayPreviewBody(a.org.id, a.worker.id), 403, true);
    await denied(a.cookie, { ...fullDayPreviewBody(a.org.id, a.worker.id), intervals: [] }, 400);
    await denied(a.cookie, {
      ...fullDayPreviewBody(a.org.id, a.worker.id),
      intervals: [{ kind: "full_day", workDate: "2026-02-30", timezone: "Asia/Manila" }],
    }, 400);
    await denied(a.cookie, {
      ...fullDayPreviewBody(a.org.id, a.worker.id),
      intervals: [{ kind: "timed", workDate: LEAVE_DATE,
        startLocalTime: "17:00", endLocalTime: "15:00", timezone: "Asia/Manila" }],
    }, 400);
    await denied(a.cookie, fullDayPreviewBody(a.org.id, separated.id), 409);

    for (const e of [a, b, victim]) {
      assertLeavePreviewSourcesEqual(before.get(e.org.id), await snapshot(e));
    }
    assertLeavePreviewSourcesEqual(victimBefore, await victimSnapshot(victim.org.id));
    assert.ok(positives >= 9 && denials >= 15 && ignoredSpoofs === 3);
    console.log(JSON.stringify({
      kind: "tenant-leave-preview-isolation",
      method: "POST leave/preview",
      scenario: "two real owners, higher-ID victim, same-employer independent employees",
      ownSuccesses: positives, rejected: denials, employeeIdSpoofsIgnored: ignoredSpoofs,
      persistedApprovedShiftOverrides: 4, ownAndVictimSourceSnapshotsUnchanged: true,
      payrollOrLeaveChanges: 0, payoutOrProviderCalls: 0,
      environment: "disposable PostgreSQL 16 and production-mode localhost HTTP",
      productionCertified: false, manifestCredit: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-leave-preview-http.mjs")) {
  verifyLeavePreviewTenantHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
