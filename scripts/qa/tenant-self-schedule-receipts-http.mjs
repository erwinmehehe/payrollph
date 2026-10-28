/**
 * Isolated PostgreSQL 16 + real production-mode localhost HTTP for the
 * two still-GAP self/schedule-receipts methods. Fictional employer/worker data.
 * No tenant method credits, provider connections, payroll or deployment actions.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ENDPOINT, requireDisposableScheduleReceipt,
  assertOwnSchedule, assertPrivateDenial, assertUnchanged, assertNoPrivateResponse,
} from "./tenant-self-schedule-receipts-contract.mjs";

export async function proveSelfScheduleReceiptIsolation() {
  // Fail closed BEFORE importing modules that open a PostgreSQL connection.
  requireDisposableScheduleReceipt();
  const [{ db, pool }, s, t, { eq, asc }, { workforceScheduleReceipts: receipts },
    { manilaWorkDate }, { auditBusinessSnapshot }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("drizzle-orm"),
    import("../../src/lib/workforce-schedule-receipt-schema.ts"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const date = manilaWorkDate();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const records = (table, organizationId) => db.select().from(table)
    .where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
  async function snapshot(organizationId) {
    const [employees, memberships, overrides, schedules, receiptRows, audit, payroll] = await Promise.all([
      records(s.employees, organizationId),
      records(s.userOrganizations, organizationId),
      records(s.scheduleOverrides, organizationId),
      records(s.shiftDefinitions, organizationId),
      records(receipts, organizationId),
      records(s.auditEvents, organizationId),
      records(s.payrollRuns, organizationId),
    ]);
    return { employees, memberships, overrides, schedules, receipts: receiptRows,
      audit: auditBusinessSnapshot(audit), payroll };
  }
  async function login(e, worker, suffix) {
    const [user] = await db.insert(s.users).values({
      name: e.marker + " " + suffix + " synthetic employee",
      email: (e.marker + "-" + suffix).toLowerCase() + "@example.invalid",
      role: "employee", active: true, employeeId: worker.id,
      passwordHash: "not-a-real-login",
    }).returning();
    const [membership] = await db.insert(s.userOrganizations).values({
      organizationId: e.org.id, userId: user.id, role: "employee",
      workerEmployeeId: worker.id, active: true,
    }).returning();
    const session = await t.standaloneMakeSession(user.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return { user, membership, cookie: session.cookie };
  }
  async function shift(e, worker, suffix) {
    const shiftName = e.marker + " " + suffix + " private fictional roster";
    const [row] = await db.insert(s.shiftDefinitions).values({
      organizationId: e.org.id, code: "RCPT-" + suffix,
      name: shiftName, startTime: "09:00", endTime: "17:00",
      breakMinutes: 60, spansMidnight: false,
    }).returning();
    const [override] = await db.insert(s.scheduleOverrides).values({
      organizationId: e.org.id, employeeId: worker.id, workDate: date,
      kind: "shift", isRestDay: false, status: "approved",
      segments: [{ shiftDefinitionId: row.id, segmentOrder: 1 }],
      reason: e.marker + " synthetic receipt fixture", createdBy: "Fictional maker",
      approvedBy: "Fictional checker",
    }).returning();
    return { shift: row, override, shiftName };
  }
  async function seed(label) {
    const e = await t.seedEmployer(label, nonce, t.standaloneMakeSession);
    const self = await login(e, e.worker, "SELF");
    const ownShift = await shift(e, e.worker, "OWN");
    const peerWorker = await t.addWorker(e, "PEER", { payProfile: false });
    const peerLogin = await login(e, peerWorker, "PEER");
    const peerShift = await shift(e, peerWorker, "PEER");
    return { ...e, ...ownShift, self, peer: {
      worker: peerWorker, self: peerLogin, ...peerShift,
      date, label: label + "-PEER",
    }, date };
  }
  async function get(e, path = ENDPOINT, cookie = e.self.cookie) {
    return t.standaloneRequest(path, { cookie });
  }
  async function post(e, body, path = ENDPOINT, cookie = e.self.cookie) {
    return t.standaloneRequest(path, { method: "POST", cookie, body });
  }
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
      "SCHEDULE_RECEIPT_TENANT_REFUSED: only an empty disposable PG16 database is allowed");
    const a = await seed("ATTA");
    const b = await seed("ATTB");
    const victim = await seed("VICTIM");
    assert.deepEqual([a.org.id, b.org.id, victim.org.id], [1, 2, 3],
      "Expected exact disposable 1,2,3 allowlisted fixture, not a live employer");
    for (const field of ["org", "worker", "shift", "override"]) {
      assert.ok(victim[field].id > a.peer[field === "worker" ? "worker" : field]?.id ||
        (field === "org" && victim.org.id > a.org.id));
      assert.ok(victim[field].id > b.peer[field === "worker" ? "worker" : field]?.id ||
        (field === "org" && victim.org.id > b.org.id));
    }
    assert.notEqual(a.self.cookie, b.self.cookie);
    assert.notEqual(b.self.cookie, victim.self.cookie);
    const victimBefore = await snapshot(victim.org.id);
    const victimRead = await get(victim);
    const victimDay = assertOwnSchedule(victimRead, victim, "pending", [
      a.shiftName, b.shiftName,
    ]);
    assert.equal(victimBefore.receipts.length, 0);
    const attackers = [a, b];
    const original = new Map();
    for (const actor of attackers) {
      const other = actor === a ? b : a;
      const ownView = await get(actor);
      const ownDay = assertOwnSchedule(ownView, actor, "pending", [
        other.shiftName, other.peer.shiftName, victim.shiftName, actor.peer.shiftName,
      ]);
      original.set(actor.org.id, ownDay);
      const peerView = await get(actor.peer, ENDPOINT, actor.peer.self.cookie);
      assertOwnSchedule(peerView, actor.peer, "pending", [actor.shiftName, victim.shiftName]);
      assert.notEqual(ownDay.snapshotHash, peerView.json.days[0].snapshotHash);
      const forgedGet = await get(actor, ENDPOINT + "?organizationId=" + victim.org.id +
        "&employeeId=" + victim.worker.id + "&userId=" + victim.self.user.id);
      assertPrivateDenial(forgedGet, 400, [victim.shiftName, other.shiftName]);
      assertUnchanged(victimBefore, await snapshot(victim.org.id),
        "own and forged GET must not change the real victim");
    }

    // Actual POST success for two independently authenticated employers, with
    // the persisted employee/user/hash receipt AND matching audit assertion.
    for (const actor of attackers) {
      const ownDay = original.get(actor.org.id);
      const body = { workDate: date, snapshotHash: ownDay.snapshotHash, acknowledged: true };
      const before = await snapshot(actor.org.id);
      const posted = await post(actor, body);
      assert.equal(posted.status, 201, actor.label + " must create a real receipt");
      assert.deepEqual(Object.keys(posted.json).sort(),
        ["acknowledgedAt", "created", "snapshotHash", "workDate"]);
      assert.equal(posted.json.created, true);
      assert.equal(posted.json.workDate, date);
      assert.equal(posted.json.snapshotHash, ownDay.snapshotHash);
      assertNoPrivateResponse(posted, [victim.shiftName]);
      const after = await snapshot(actor.org.id);
      assert.equal(after.receipts.length, before.receipts.length + 1);
      const saved = after.receipts.find(row => row.snapshotHash === ownDay.snapshotHash);
      assert.ok(saved && saved.id, "own HTTP response must match persisted receipt");
      assert.equal(saved.organizationId, actor.org.id);
      assert.equal(saved.employeeId, actor.worker.id);
      assert.equal(saved.acknowledgedByUserId, actor.self.user.id);
      assert.equal(saved.workDate, date);
      assert.equal(saved.snapshot.segments[0].shiftDefinitionId, actor.shift.id);
      assert.equal(after.audit.length, before.audit.length + 1);
      const event = after.audit.find(row => row.action === "WFM employee schedule receipt acknowledged");
      assert.ok(event, "one actor-specific receipt audit must be committed");
      assert.equal(event.organizationId, actor.org.id);
      assert.equal(event.actor, "User #" + actor.self.user.id);
      assert.equal(event.metadata.receiptId, saved.id);
      assert.equal(event.metadata.employeeId, actor.worker.id);
      assert.equal(event.metadata.userId, actor.self.user.id);
      assert.equal(event.metadata.workDate, date);
      assert.equal(event.metadata.snapshotHash, ownDay.snapshotHash);
      assert.equal(event.metadata.payrollChanged, false);
      for (const field of ["employees", "memberships", "overrides", "schedules", "payroll"]) {
        assert.deepEqual(after[field], before[field], "own POST must not mutate " + field);
      }
      assertOwnSchedule(await get(actor), actor, "acknowledged", [victim.shiftName]);
      const repeated = await post(actor, body);
      assert.equal(repeated.status, 200, "duplicate must be idempotent");
      assert.equal(repeated.json.created, false);
      assert.equal(repeated.json.acknowledgedAt, posted.json.acknowledgedAt);
      assertUnchanged(after, await snapshot(actor.org.id), "idempotent POST");
      assertUnchanged(victimBefore, await snapshot(victim.org.id), "own POST victim protection");
    }

    const stable = new Map(await Promise.all([a, b, victim].map(async e =>
      [e.org.id, await snapshot(e.org.id)])));
    async function denied(label, response, expectedStatus) {
      assertPrivateDenial(response, expectedStatus,
        [victim.shiftName, a.shiftName, b.shiftName]);
      for (const e of [a, b, victim]) {
        assertUnchanged(stable.get(e.org.id), await snapshot(e.org.id), label + " " + e.label);
      }
    }
    for (const actor of attackers) {
      const other = actor === a ? b : a;
      const ownDay = original.get(actor.org.id);
      const valid = { workDate: date, snapshotHash: ownDay.snapshotHash, acknowledged: true };
      await denied(actor.label + " forged body employer/employee", await post(actor, {
        ...valid, organizationId: victim.org.id, employeeId: victim.worker.id,
      }), 400);
      await denied(actor.label + " forged POST query", await post(actor, valid,
        ENDPOINT + "?organizationId=" + victim.org.id + "&employeeId=" + victim.worker.id), 400);
      await denied(actor.label + " stolen victim schedule hash", await post(actor, {
        ...valid, snapshotHash: victimDay.snapshotHash,
      }), 409);
      await denied(actor.label + " owner GET", await get(actor, ENDPOINT, actor.cookie), 403);
      await denied(actor.label + " owner POST",
        await post(actor, valid, ENDPOINT, actor.cookie), 403);
      const [forged] = await db.insert(s.users).values({
        name: actor.marker + " forged link", email: actor.marker.toLowerCase() + "-forged@example.invalid",
        role: "employee", employeeId: victim.worker.id, passwordHash: "fictional-invalid",
        active: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: forged.id, organizationId: actor.org.id, role: "employee", active: true,
      });
      const session = await t.standaloneMakeSession(forged.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      // Account creation is an intentional synthetic fixture mutation. Freeze
      // the new source state before asserting denial has no further side effects.
      stable.set(actor.org.id, await snapshot(actor.org.id));
      await denied(actor.label + " forged victim employee link GET",
        await get(actor, ENDPOINT, session.cookie), 403);
      await denied(actor.label + " forged victim employee link POST",
        await post(actor, valid, ENDPOINT, session.cookie), 403);
      // The intentionally added, non-privileged forged account is not part
      // of the organization membership snapshot used for later negative cases.
      stable.set(actor.org.id, await snapshot(actor.org.id));
      assert.notEqual(actor.org.id, other.org.id);
    }
    await denied("anonymous GET", await t.standaloneRequest(ENDPOINT), 401);
    await denied("anonymous POST", await t.standaloneRequest(ENDPOINT, {
      method: "POST", body: { workDate: date, snapshotHash: victimDay.snapshotHash, acknowledged: true },
    }), 401);

    // Revoke Alpha after a successful receipt. Keep the SAME session alive and
    // an active membership in Beta, proving no stale Alpha authorization.
    await db.insert(s.userOrganizations).values({
      userId: a.self.user.id, organizationId: b.org.id, role: "employee", active: true,
    });
    await db.update(s.userOrganizations).set({ active: false })
      .where(eq(s.userOrganizations.id, a.self.membership.id));
    const alphaAfterRevoke = await snapshot(a.org.id);
    const betaAfterSecondMembership = await snapshot(b.org.id);
    assertPrivateDenial(await get(a), 403, [a.shiftName, b.shiftName, victim.shiftName]);
    assertPrivateDenial(await post(a, {
      workDate: date, snapshotHash: original.get(a.org.id).snapshotHash, acknowledged: true,
    }), 403, [a.shiftName, b.shiftName, victim.shiftName]);
    assertUnchanged(alphaAfterRevoke, await snapshot(a.org.id), "post-revocation Alpha blocked");
    assertUnchanged(betaAfterSecondMembership, await snapshot(b.org.id),
      "Alpha access loss cannot mutate Beta");
    assertOwnSchedule(await get(b), b, "acknowledged", [a.shiftName, victim.shiftName]);
    assertUnchanged(victimBefore, await snapshot(victim.org.id),
      "all real victim employee, schedules, receipts, audits and payroll remain unchanged");
    console.log("FICTIONAL_PG16_HTTP_SCHEDULE_RECEIPTS: own GET/POST for A+B, peer isolation, " +
      "real higher-ID victim, forged selectors/identity and cross-employer membership revocation; " +
      "persisted audit/receipt matches; ZERO method coverage credits");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-self-schedule-receipts-http.mjs")) {
  proveSelfScheduleReceiptIsolation().catch(error => {
    console.error("FICTIONAL_PG16_HTTP_SCHEDULE_RECEIPTS_FAIL:", error.message);
    process.exitCode = 1;
  });
}
