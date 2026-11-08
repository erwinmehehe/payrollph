/**
 * Dedicated two-attacker proof for POST and PATCH multi-entity/transfers (move a worker between two legal employers
 * of ONE tenant, under maker-checker). Two independent attacker employers and a higher-ID victim (three fictional
 * tenants plus seven fillers so the victim's IDs exceed six), each with two legal employers, a maker (owner), an
 * independent checker (admin) and two workers, behind production-mode localhost HTTP on disposable PG16.
 *
 * Each attacker proves REAL own successes (a transfer proposed by the maker, refused for self-approval, approved and
 * applied by the independent checker so the worker, the employer-of-record intervals, the employment event and the
 * audit trail all change; a second request proposed and rejected without moving the worker), while every attempt
 * to act on the victim, with forged organization/employee/employer selectors or a foreign employer header, is refused
 * with the victim's rows byte-identical. A foreign transfer ID answers exactly like an absent one.
 *
 * No payout provider, notification provider or worker is configured or reachable; nothing here moves money.
 * This is a proof, not a credit: coverageCredits is 0 and independent review is not claimed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  TRANSFERS_PATCH_METHOD, TRANSFERS_POST_METHOD, TRANSFERS_TITLE, TRANSFER_PATH,
  assertRefusal, assertRowsUnchanged, assertSameAnswer, dayBefore, manilaToday, requireDisposableTransfers,
} from "./tenant-transfers-contract.mjs";

export async function verifyTransfersTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableTransfers();
  const [{ db, pool }, schema, { eq, and }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { auditEvents, employeeEntityAssignments, employees, entityTransferRequests, legalEntities, userLegalEntityGrants,
    userOrganizations, users, sessions, workerEmploymentEvents } = schema;
  const { addWorker, seedEmployer, standaloneMakeSession } = fixture;
  const BASE = process.env.SECURITY_SMOKE_URL;

  /** Real HTTP with the real same-origin headers and, when given, the real legal-employer selector header. */
  async function req(path, { method = "GET", cookie, body, entity, headers = {} } = {}) {
    const sent = { ...headers };
    if (cookie) sent.cookie = cookie;
    if (method !== "GET") Object.assign(sent, { origin: BASE, "sec-fetch-site": "same-origin" });
    if (entity !== undefined) sent["x-legal-entity-id"] = String(entity);
    if (body !== undefined) sent["content-type"] = "application/json";
    const response = await fetch(new URL(path, BASE), {
      method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", cache: "no-store",
    });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, text, json, headers: response.headers };
  }
  const crossSite = async (method, cookie, body) => {
    const response = await fetch(new URL(TRANSFER_PATH, BASE), {
      method, redirect: "manual", cache: "no-store",
      headers: { cookie, origin: "https://attacker.example.test", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text(), headers: response.headers, json: null };
  };

  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "TRANSFERS_PROOF_REFUSED: genuinely empty disposable users required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
    const today = manilaToday();
    const REASON = "Fictional reassignment between two legal employers";

    /** Everything a transfer needs: a second employer, grants for maker and checker, an open employer-of-record interval. */
    async function prepare(e) {
      const [entity2] = await db.insert(legalEntities).values({
        organizationId: e.org.id, code: (e.marker.slice(0, 26) + "-TWO"), legalName: e.marker + " Two Inc.",
        displayName: e.marker + " Two", primaryEntity: false, active: true,
      }).returning();
      const [checker] = await db.insert(users).values({
        email: e.marker.toLowerCase() + "-checker@example.invalid", name: e.marker + " checker",
        passwordHash: "fictional-session-only", role: "admin", totpEnabled: true,
      }).returning();
      await db.insert(userOrganizations).values({ userId: checker.id, organizationId: e.org.id, role: "admin", active: true });
      const session = await standaloneMakeSession(checker.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
      for (const userId of [e.owner.id, checker.id]) {
        for (const legalEntityId of [e.entity.id, entity2.id]) {
          await db.insert(userLegalEntityGrants).values({ organizationId: e.org.id, userId, legalEntityId, grantedByUserId: e.owner.id });
        }
      }
      const worker2 = await addWorker(e, "W2");
      for (const worker of [e.worker, worker2]) {
        await db.insert(employeeEntityAssignments).values({
          organizationId: e.org.id, employeeId: worker.id, legalEntityId: e.entity.id, effectiveFrom: String(worker.startDate),
        });
      }
      Object.assign(e, { entity2, checker, checkerCookie: session.cookie, worker2 });
      return e;
    }
    const sourceEmployerOf = async (workerId) => (await db.select().from(employees).where(eq(employees.id, workerId)))[0].legalEntityId;

    const a = await prepare(await seedEmployer("ATTA", nonce, standaloneMakeSession));
    const b = await prepare(await seedEmployer("ATTB", nonce, standaloneMakeSession));
    // Filler employers consume low IDs so the victim's org, user, employer and request IDs exceed both attackers' and six.
    for (let i = 0; i < 7; i++) await prepare(await seedEmployer("FILL" + i, nonce, standaloneMakeSession));
    const victim = await prepare(await seedEmployer("VICTIM", nonce, standaloneMakeSession));
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6) && victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.entity2.id > Math.max(a.entity2.id, b.entity2.id, 6), "the victim employer must be a real higher-ID row");
    // The victim's own genuine pending request: the object every foreign PATCH aims at.
    const [victimPending] = await db.insert(entityTransferRequests).values({
      organizationId: victim.org.id, employeeId: victim.worker.id, fromLegalEntityId: victim.entity.id, toLegalEntityId: victim.entity2.id,
      effectiveDate: today, status: "pending_approval", reason: REASON, serviceStartDate: String(victim.worker.startDate),
      continuityNote: "Fictional continuity note for " + victim.marker, requestedByUserId: victim.owner.id,
    }).returning();

    const orgTables = (await pool.query(`SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name`)).rows.map((row) => row.table_name);
    for (const needed of ["audit_events", "employees", "entity_transfer_requests", "employee_entity_assignments", "worker_employment_events",
      "user_legal_entity_grants", "legal_entities"]) assert.ok(orgTables.includes(needed), "snapshot must cover " + needed);
    const snapshot = async (e, { identity = true } = {}) => {
      const state = {};
      for (const name of orgTables) {
        assert.match(name, /^[a-z_0-9]+$/);
        state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [e.org.id])).rows.map((row) => row.row);
      }
      state.payroll_entries = (await pool.query(`SELECT to_jsonb(x) AS row FROM payroll_entries x JOIN payroll_runs r ON r.id=x.payroll_run_id
        WHERE r.organization_id=$1 ORDER BY x.id`, [e.org.id])).rows.map((row) => row.row);
      if (identity) {
        for (const [key, id] of [["owner", e.owner.id], ["checker", e.checker.id]]) {
          state[key] = (await pool.query(`SELECT to_jsonb(u) AS row FROM users u WHERE u.id=$1`, [id])).rows.map((row) => row.row);
          state[key + "_sessions"] = (await pool.query(`SELECT to_jsonb(s) AS row FROM sessions s WHERE s.user_id=$1 ORDER BY s.id`, [id])).rows.map((row) => row.row);
        }
      }
      return state;
    };
    const auditRows = async (e, action) => (await db.select().from(auditEvents)
      .where(and(eq(auditEvents.organizationId, e.org.id), eq(auditEvents.action, action))));
    const requestsOf = async (e) => (await db.select().from(entityTransferRequests)
      .where(eq(entityTransferRequests.organizationId, e.org.id))).sort((x, y) => x.id - y.id);
    const eventsOf = async (e, workerId) => (await db.select().from(workerEmploymentEvents)
      .where(and(eq(workerEmploymentEvents.organizationId, e.org.id), eq(workerEmploymentEvents.employeeId, workerId))));
    const assignmentsOf = async (e, workerId) => (await db.select().from(employeeEntityAssignments)
      .where(and(eq(employeeEntityAssignments.organizationId, e.org.id), eq(employeeEntityAssignments.employeeId, workerId))))
      .sort((x, y) => x.id - y.id);
    const forbidden = [victim.marker, victim.owner.email, victim.checker.email, victim.worker.employeeNo, victim.entity2.legalName];
    const propose = (e, body = {}, extra = {}) => req(TRANSFER_PATH, { method: "POST", cookie: extra.cookie ?? e.cookie, entity: extra.entity ?? e.entity.id,
      body: { organizationId: e.org.id, employeeId: e.worker.id, toLegalEntityId: e.entity2.id, effectiveDate: today, reason: REASON, ...body } });
    const decide = (e, id, action, extra = {}) => req(TRANSFER_PATH, { method: "PATCH", cookie: extra.cookie ?? e.checkerCookie, entity: extra.entity ?? e.entity.id,
      body: { id, organizationId: extra.organizationId ?? e.org.id, action } });

    const journeys = {};
    for (const [attacker, other, key] of [[a, b, "A"], [b, a, "B"]]) {
      const victimBefore = await snapshot(victim);
      const otherBefore = await snapshot(other);
      const mustStayUnchanged = async (label) => {
        assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + key + "'s " + label);
        assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + key + "'s " + label);
      };

      // ---- POST: every forged or foreign proposal is refused BEFORE the real own proposal exists ----
      const ownBefore = await requestsOf(attacker);
      assert.equal(ownBefore.length, 0, "the attacker starts with no transfer request");
      const absent = await propose(attacker, { employeeId: 2_000_000_000 });
      assertRefusal(absent, 404, forbidden);
      const foreignOrg = await propose(attacker, { organizationId: victim.org.id, employeeId: victim.worker.id, toLegalEntityId: victim.entity2.id },
        { entity: victim.entity.id });
      assertRefusal(foreignOrg, 403, forbidden);
      const foreignWorker = await propose(attacker, { employeeId: victim.worker.id });
      assertRefusal(foreignWorker, 404, forbidden);
      assertSameAnswer(foreignWorker, absent, key + ": a foreign worker ID versus an absent worker ID");
      assertRefusal(await propose(attacker, { toLegalEntityId: victim.entity2.id }), 403, forbidden);
      assertRefusal(await propose(attacker, {}, { entity: victim.entity.id }), 403, forbidden);
      assertRefusal(await propose(attacker, { organizationId: victim.org.id }, { entity: victim.entity.id }), 403, forbidden);
      assertRefusal(await propose(attacker, {}, { entity: "all" }), 403, forbidden);
      assertRefusal(await req(TRANSFER_PATH, { method: "POST", body: { organizationId: attacker.org.id } }), 401, forbidden);
      assertRefusal(await crossSite("POST", attacker.cookie, { organizationId: attacker.org.id, employeeId: attacker.worker.id,
        toLegalEntityId: attacker.entity2.id, effectiveDate: today, reason: REASON }), 403, forbidden);
      assert.equal((await requestsOf(attacker)).length, 0, "no refused proposal created an own request");
      assert.equal(await sourceEmployerOf(attacker.worker.id), attacker.entity.id, "no refused proposal moved the own worker");
      await mustStayUnchanged("refused proposals");

      // ---- POST: the real own proposal by the maker ----
      const proposed = await propose(attacker);
      assert.equal(proposed.status, 201, "own proposal: " + proposed.text.slice(0, 300));
      const transferId = proposed.json?.transfer?.id;
      assert.ok(Number.isSafeInteger(transferId) && transferId > 0, "the proposal returns its id");
      assert.equal(proposed.json.transfer.status, "pending_approval");
      const [row] = await requestsOf(attacker);
      assert.equal(row.id, transferId);
      assert.equal(row.organizationId, attacker.org.id, "the request belongs to the own employer");
      assert.equal(row.employeeId, attacker.worker.id);
      assert.equal(row.fromLegalEntityId, attacker.entity.id);
      assert.equal(row.toLegalEntityId, attacker.entity2.id);
      assert.equal(row.requestedByUserId, attacker.owner.id, "the maker is the authenticated owner, never a body-supplied user");
      assert.equal(row.status, "pending_approval");
      assert.equal(row.approvedByUserId, null);
      assert.equal(row.effectiveDate, today);
      const requested = (await auditRows(attacker, "Legal entity transfer requested")).filter((r) => r.metadata?.requestId === transferId);
      assert.equal(requested.length, 1, "exactly one own audit receipt for the proposal");
      assert.equal(requested[0].metadata.requestedByUserId, attacker.owner.id);
      assert.equal(await sourceEmployerOf(attacker.worker.id), attacker.entity.id, "a proposal alone moves nobody");
      // A second proposal for the same worker is a conflict and writes nothing.
      const replay = await propose(attacker);
      assert.equal(replay.status, 409);
      assert.equal((await requestsOf(attacker)).length, 1, "a replayed proposal creates no second request");
      await mustStayUnchanged("own proposal and its replay");

      // ---- PATCH: refusals that must leave the pending request pending ----
      assertRefusal(await decide(attacker, transferId, "approve", { cookie: attacker.cookie }), 403, forbidden);
      assert.equal((await requestsOf(attacker))[0].status, "pending_approval", "the maker cannot approve their own request");
      assert.equal((await decide(attacker, victimPending.id, "approve")).status, 404, "a foreign transfer id is not found under the own tenant");
      const absentDecision = await decide(attacker, 2_000_000_000, "approve");
      const foreignDecision = await decide(attacker, victimPending.id, "approve");
      assertRefusal(foreignDecision, 404, forbidden);
      assertSameAnswer(foreignDecision, absentDecision, key + ": a foreign transfer ID versus an absent transfer ID");
      for (const actor of [attacker.cookie, attacker.checkerCookie]) {
        for (const action of ["approve", "reject", "apply"]) {
          assertRefusal(await decide(attacker, victimPending.id, action, { cookie: actor, organizationId: victim.org.id, entity: victim.entity.id }), 403, forbidden);
        }
      }
      assertRefusal(await decide(attacker, transferId, "approve", { entity: victim.entity.id }), 403, forbidden);
      assertRefusal(await decide(attacker, transferId, "delete"), 400, forbidden);
      assertRefusal(await req(TRANSFER_PATH, { method: "PATCH", body: { id: transferId, organizationId: attacker.org.id, action: "approve" } }), 401, forbidden);
      assertRefusal(await crossSite("PATCH", attacker.checkerCookie, { id: transferId, organizationId: attacker.org.id, action: "approve" }), 403, forbidden);
      assert.equal((await requestsOf(attacker))[0].status, "pending_approval", "no refused decision changed the own request");
      assert.equal(await sourceEmployerOf(attacker.worker.id), attacker.entity.id);
      assert.equal((await db.select().from(entityTransferRequests).where(eq(entityTransferRequests.id, victimPending.id)))[0].status, "pending_approval",
        "the victim's pending request is still pending");
      await mustStayUnchanged("refused decisions");

      // ---- PATCH: the independent checker approves; the due transfer is applied in the same transaction ----
      const approved = await decide(attacker, transferId, "approve");
      assert.equal(approved.status, 200, "own approval: " + approved.text.slice(0, 300));
      assert.equal(approved.json?.transfer?.id, transferId);
      assert.equal(approved.json.transfer.status, "applied", "an approved transfer that is already due is applied");
      const [decided] = await requestsOf(attacker);
      assert.equal(decided.status, "applied");
      assert.equal(decided.approvedByUserId, attacker.checker.id, "the approver is the authenticated checker");
      assert.notEqual(decided.approvedByUserId, decided.requestedByUserId, "maker and checker are different people");
      assert.ok(decided.approvedAt && decided.appliedAt, "approval and application are timestamped");
      assert.equal(await sourceEmployerOf(attacker.worker.id), attacker.entity2.id, "the worker now belongs to the target employer");
      const intervals = await assignmentsOf(attacker, attacker.worker.id);
      assert.equal(intervals.length, 2, "one closed and one new employer-of-record interval");
      assert.equal(intervals[0].legalEntityId, attacker.entity.id);
      assert.equal(intervals[0].effectiveUntil, dayBefore(today), "the old interval ends the day before the move");
      assert.equal(intervals[1].legalEntityId, attacker.entity2.id);
      assert.equal(intervals[1].effectiveFrom, today);
      assert.equal(intervals[1].effectiveUntil, null, "the new interval is open");
      const events = await eventsOf(attacker, attacker.worker.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, "legal_employer_transfer");
      assert.equal(events[0].fromLegalEntityId, attacker.entity.id);
      assert.equal(events[0].toLegalEntityId, attacker.entity2.id);
      assert.equal(events[0].actorUserId, attacker.checker.id);
      assert.equal(events[0].metadata.separationCreated, false, "a transfer is not a separation");
      assert.equal((await auditRows(attacker, "Legal employer transfer applied")).filter((r) => r.metadata?.transferId === transferId).length, 1,
        "exactly one own audit receipt for the application");
      // A second decision on the same request is a conflict and changes nothing.
      const again = await decide(attacker, transferId, "approve");
      assert.equal(again.status, 409);
      assert.equal((await eventsOf(attacker, attacker.worker.id)).length, 1, "a repeated decision records no second event");
      assert.equal((await assignmentsOf(attacker, attacker.worker.id)).length, 2);
      await mustStayUnchanged("own approval");

      // ---- PATCH: a second request is proposed and REJECTED; the worker does not move ----
      const second = await propose(attacker, { employeeId: attacker.worker2.id });
      assert.equal(second.status, 201, "second proposal: " + second.text.slice(0, 300));
      const rejected = await decide(attacker, second.json.transfer.id, "reject");
      assert.equal(rejected.status, 200, "own rejection: " + rejected.text.slice(0, 300));
      assert.equal(rejected.json.transfer.status, "rejected");
      const rejectedRow = (await requestsOf(attacker)).find((r) => r.id === second.json.transfer.id);
      assert.equal(rejectedRow.status, "rejected");
      assert.equal(rejectedRow.approvedByUserId, attacker.checker.id);
      assert.equal(rejectedRow.appliedAt, null);
      assert.equal(await sourceEmployerOf(attacker.worker2.id), attacker.entity.id, "a rejected request moves nobody");
      assert.equal((await eventsOf(attacker, attacker.worker2.id)).length, 0, "a rejected request records no employment event");
      assert.equal((await assignmentsOf(attacker, attacker.worker2.id)).length, 1);
      assert.equal((await auditRows(attacker, "Legal entity transfer rejected")).length, 1);

      // The victim and the other attacker are byte-identical after this attacker's complete journey.
      await mustStayUnchanged("complete journey");
      journeys[key] = { transferId, auditApplied: (await auditRows(attacker, "Legal employer transfer applied"))[0].id, rejectedId: rejectedRow.id };
    }
    assert.notEqual(journeys.A.transferId, journeys.B.transferId, "A's transfer cannot satisfy B's");
    assert.notEqual(journeys.A.auditApplied, journeys.B.auditApplied, "A's application evidence cannot satisfy B's");
    const stillPending = (await db.select().from(entityTransferRequests).where(eq(entityTransferRequests.id, victimPending.id)))[0];
    assert.equal(stillPending.status, "pending_approval", "the victim's request was never decided by anyone else");
    assert.equal(await sourceEmployerOf(victim.worker.id), victim.entity.id, "the victim's worker never moved");

    console.log(JSON.stringify({
      kind: TRANSFERS_TITLE, methods: [TRANSFERS_POST_METHOD, TRANSFERS_PATCH_METHOD], independentAttackers: 2, higherIdVictim: true,
      own: ["proposal by the maker", "replayed proposal is a conflict", "independent checker approves and the worker moves",
        "intervals, employment event and audit trail written", "a second request rejected without moving the worker"],
      refusals: ["foreign organization", "foreign worker", "foreign target employer", "foreign employer header", "all-employers selector", "absent ids identical to foreign ids",
        "maker self-approval", "foreign transfer decisions by maker and checker", "invalid action", "anonymous", "cross-site"],
      forgedSelectorsIgnored: true, victimByteIdentical: true, providersContacted: 0, moneyMoved: false,
      productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { methods: [TRANSFERS_POST_METHOD, TRANSFERS_PATCH_METHOD], credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-transfers-http.mjs")) {
  verifyTransfersTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Transfers isolation proof failed");
    process.exitCode = 1;
  });
}
