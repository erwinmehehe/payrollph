/**
 * Self-service 1:1 action-item PATCH: real production-mode localhost HTTP,
 * fresh fictional PostgreSQL 16, two independent employee attackers and a
 * genuinely persisted higher-ID victim. Never contacts live organizations,
 * payout providers, worker queues or external services.
 *
 * Provisional evidence only. No manifest credit or product certification.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposablePerformance } from "./tenant-self-performance-contract.mjs";

export function requireDisposableActionItems(env = process.env) {
  requireDisposablePerformance(env);
  assert.equal(env.TENANT_SELF_ACTION_ITEMS_MODE, "fictional-only",
    "ACTION_ITEMS_REFUSED: independent fictional-only opt-in is required");
  assert.equal(env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  assert.equal(env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  for (const name of ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "NEON_DATABASE_URL",
    "DATABASE_URL_DIRECT", "VERCEL", "VERCEL_URL", "VERCEL_ENV"]) {
    assert.ok(!env[name], "ACTION_ITEMS_REFUSED: external credential or hosted environment: " + name);
  }
}

export async function proveSelfActionItemsHttp() {
  // No app, DB or network imports until the disposable-only guard passes.
  requireDisposableActionItems();
  const [{ db, pool }, schema, { and, asc, eq }, http] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { organizations, users, userOrganizations, sessions, employees,
    performanceOneOnOnes, performanceOneOnOneActionItems,
    performanceOneOnOneActionItemEvents, payrollRuns, auditEvents } = schema;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const PATH = "/api/self/performance/action-items";
  const actors = [];

  async function login(employer, worker, suffix) {
    const name = employer.marker + suffix + " fictional employee";
    const [user] = await db.insert(users).values({
      email: (employer.marker + suffix).toLowerCase() + "@example.invalid",
      name, passwordHash: "fictional-session-only", role: "employee",
      employeeId: worker.id, active: true, totpEnabled: true,
    }).returning();
    const [membership] = await db.insert(userOrganizations).values({
      userId: user.id, organizationId: employer.org.id,
      workerEmployeeId: worker.id, role: "employee", active: true,
    }).returning();
    const session = await http.standaloneMakeSession(user.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, session.id));
    return { user, membership, cookie: session.cookie, name };
  }

  async function meetingAndItems(employer, worker, suffix, self) {
    const marker = employer.marker + suffix;
    const [meeting] = await db.insert(performanceOneOnOnes).values({
      organizationId: employer.org.id, employeeId: worker.id,
      managerUserId: employer.owner.id, scheduledFor: new Date("2026-12-15T09:00:00Z"),
      agenda: marker + " fictional 1:1", createdByName: employer.owner.name,
      createdByUserId: employer.owner.id,
    }).returning();
    async function item(label, fields = {}) {
      const [record] = await db.insert(performanceOneOnOneActionItems).values({
        organizationId: employer.org.id, oneOnOneId: meeting.id,
        employeeId: worker.id, ownerKind: "employee", ownerUserId: self.user.id,
        ownerEmployeeId: worker.id, ownerName: self.name,
        title: marker + " " + label, dueDate: "2026-12-20",
        visibility: "employee_shared", createdByName: employer.owner.name,
        createdByUserId: employer.owner.id, ...fields,
      }).returning();
      return record;
    }
    const shared = await item("owned action");
    const simultaneous = await item("concurrent completion");
    const rollback = await item("atomic rollback");
    const privateItem = await item("private manager action", {
      ownerKind: "manager", ownerUserId: employer.owner.id,
      ownerEmployeeId: null, ownerName: employer.owner.name,
      visibility: "manager_private",
    });
    return { meeting, shared, simultaneous, rollback, privateItem };
  }

  async function seed(label) {
    const employer = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
    employer.self = await login(employer, employer.worker, "-SELF");
    employer.items = await meetingAndItems(employer, employer.worker, "-SELF", employer.self);
    const peerWorker = await http.addWorker(employer, "PEER", { payProfile: false });
    const peerSelf = await login(employer, peerWorker, "-PEER");
    const peerItems = await meetingAndItems(employer, peerWorker, "-PEER", peerSelf);
    employer.peer = { worker: peerWorker, self: peerSelf, items: peerItems };
    return employer;
  }

  async function snapshot(orgId) {
    const tables = {
      employees, performanceOneOnOnes, performanceOneOnOneActionItems,
      performanceOneOnOneActionItemEvents, auditEvents, payrollRuns, userOrganizations,
    };
    return Object.fromEntries(await Promise.all(Object.entries(tables).map(
      async ([name, table]) => [name, await db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id))],
    )));
  }

  async function patch(cookie, id, status, extra = {}) {
    return http.standaloneRequest(PATH, {
      method: "PATCH", cookie, body: { id, status, ...extra },
    });
  }
  function expectStatus(response, status, label) {
    assert.equal(response.status, status, label + ": HTTP " + response.status +
      " instead of " + status + "; " + response.text.slice(0, 240));
    assert.ok(!response.text.includes("__Host-linaw_session="),
      label + ": session cookie must never be reflected in responses");
    return response;
  }
  function noForeignMarker(response, foreign, label) {
    assert.ok(!response.text.includes(foreign.marker),
      label + ": victim private marker leaked in response");
    assert.ok(!response.text.includes(foreign.self.cookie.split("=")[1]),
      label + ": victim bearer token leaked in response");
    assert.ok(![...response.headers].some(([k, v]) =>
      (k + v).includes(foreign.marker)), label + ": victim marker leaked in headers");
  }
  function assertOwnedChange(before, after, actor, target, expectedStatus) {
    const id = target.id;
    const changed = after.performanceOneOnOneActionItems.find(x => x.id === id);
    assert.equal(changed.organizationId, actor.org.id);
    assert.equal(changed.employeeId, actor.worker.id);
    assert.equal(changed.ownerEmployeeId, actor.worker.id);
    assert.equal(changed.status, expectedStatus);
    for (const [name, rows] of Object.entries(before)) {
      if (name === "performanceOneOnOneActionItems") {
        assert.deepEqual(after[name].filter(row => row.id !== id),
          rows.filter(row => row.id !== id), "Other employees' action items unchanged");
      } else if (name === "auditEvents" || name === "performanceOneOnOneActionItemEvents") {
        assert.equal(after[name].length, rows.length + 1, "one " + name + " per owned update");
      } else {
        assert.deepEqual(after[name], rows, "Unrelated employer records unchanged: " + name);
      }
    }
    const event = after.performanceOneOnOneActionItemEvents.at(-1);
    const audit = after.auditEvents.at(-1);
    assert.equal(event.organizationId, actor.org.id);
    assert.equal(event.employeeId, actor.worker.id);
    assert.equal(event.actionItemId, id);
    assert.equal(event.actorUserId, actor.self.user.id);
    assert.equal(event.beforeSnapshot.status, before.performanceOneOnOneActionItems.find(x => x.id === id).status);
    assert.equal(event.afterSnapshot.status, expectedStatus);
    assert.equal(audit.organizationId, actor.org.id);
    assert.equal(audit.metadata.actionItemId, id);
    assert.equal(audit.metadata.employeeId, actor.worker.id);
    assert.equal(audit.metadata.toStatus, expectedStatus);
  }

  let checks = 0;
  try {
    for (const [name, table] of [["organizations", organizations],
      ["action items", performanceOneOnOneActionItems],
      ["audit", auditEvents], ["payroll", payrollRuns]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "ACTION_ITEMS_REFUSED: " + name + " existed before fictional fixtures");
    }
    const a = await seed("ATTA");
    const b = await seed("ATTB");
    const victim = await seed("VICTIM");
    actors.push(a, b, victim);
    for (const attacker of [a, b]) {
      assert.ok(victim.org.id > attacker.org.id);
      assert.ok(victim.worker.id > attacker.peer.worker.id);
      assert.ok(victim.items.shared.id > attacker.peer.items.shared.id);
      assert.ok(victim.self.user.id > attacker.peer.self.user.id);
    }
    assert.notEqual(a.self.cookie, b.self.cookie);
    assert.notEqual(a.self.cookie, victim.self.cookie);

    // The genuine victim controls its own nonempty resource. This rules out
    // a false 404 proof built from a missing or fabricated victim identifier.
    let victimBefore = await snapshot(victim.org.id);
    const victimOwn = expectStatus(await patch(victim.self.cookie,
      victim.items.shared.id, "in_progress"), 200, "victim owner positive");
    assert.equal(victimOwn.json.id, victim.items.shared.id);
    assertOwnedChange(victimBefore, await snapshot(victim.org.id),
      victim, victim.items.shared, "in_progress");
    checks++;
    const victimBaseline = await snapshot(victim.org.id);
    assert.equal(victimBaseline.payrollRuns.length, 0);

    for (const attacker of [a, b]) {
      const victimId = victim.items.shared.id;
      const peerId = attacker.peer.items.shared.id;
      const ownItem = attacker.items.shared.id;

      let response = expectStatus(await patch(attacker.self.cookie,
        victimId, "completed"), 404, "foreign higher-ID action item");
      noForeignMarker(response, victim, "foreign id denial");
      assert.deepEqual(await snapshot(victim.org.id), victimBaseline);
      checks++;

      response = expectStatus(await patch(attacker.self.cookie, victimId,
        "completed", { organizationId: victim.org.id,
          employeeId: victim.worker.id, ownerUserId: victim.self.user.id }),
      404, "forged victim organization and employee");
      noForeignMarker(response, victim, "forged selector denial");
      assert.deepEqual(await snapshot(victim.org.id), victimBaseline);
      checks++;

      expectStatus(await patch(attacker.self.cookie, peerId, "completed"), 404,
        "same-employer peer employee denied");
      expectStatus(await patch(attacker.self.cookie,
        attacker.items.privateItem.id, "completed"), 403,
        "same-employee manager-private action denied");
      checks += 2;

      expectStatus(await patch(attacker.self.cookie, ownItem, "invalid"), 400,
        "unsupported status rejected");
      expectStatus(await patch(undefined, ownItem, "completed"), 401,
        "anonymous actor denied");
      expectStatus(await patch(attacker.cookie, ownItem, "completed"), 403,
        "owner account cannot impersonate employee self-service");
      checks += 3;

      // Even a forged selector in the BODY must not change the employee or
      // employer bound by the signed-in session.
      let before = await snapshot(attacker.org.id);
      response = expectStatus(await patch(attacker.self.cookie, ownItem,
        "in_progress", { organizationId: victim.org.id,
          employeeId: victim.worker.id, actorUserId: victim.self.user.id }),
      200, "own status with forged irrelevant selectors");
      assert.equal(response.json.id, ownItem);
      assertOwnedChange(before, await snapshot(attacker.org.id),
        attacker, attacker.items.shared, "in_progress");
      checks++;

      before = await snapshot(attacker.org.id);
      response = expectStatus(await patch(attacker.self.cookie, ownItem,
        "completed"), 200, "own status completion");
      assert.equal(response.json.completedByUserId, attacker.self.user.id);
      assertOwnedChange(before, await snapshot(attacker.org.id),
        attacker, attacker.items.shared, "completed");
      checks++;

      before = await snapshot(attacker.org.id);
      expectStatus(await patch(attacker.self.cookie, ownItem, "in_progress"),
        409, "completed item cannot reopen");
      assert.deepEqual(await snapshot(attacker.org.id), before);
      assert.deepEqual(await snapshot(victim.org.id), victimBaseline);
      checks++;

      // Two completion requests on the same still-open item must serialize.
      before = await snapshot(attacker.org.id);
      const simultaneous = await Promise.all([
        patch(attacker.self.cookie, attacker.items.simultaneous.id, "completed"),
        patch(attacker.self.cookie, attacker.items.simultaneous.id, "completed"),
      ]);
      assert.deepEqual(simultaneous.map(x => x.status).sort(), [200, 409],
        "only one concurrent completion may commit");
      assertOwnedChange(before, await snapshot(attacker.org.id),
        attacker, attacker.items.simultaneous, "completed");
      assert.deepEqual(await snapshot(victim.org.id), victimBaseline);
      checks++;

      // A membership removed between requests cannot authorize a new write.
      const beforeRevocation = await snapshot(attacker.org.id);
      await db.update(userOrganizations).set({ active: false })
        .where(eq(userOrganizations.id, attacker.self.membership.id));
      expectStatus(await patch(attacker.self.cookie, attacker.items.rollback.id,
        "completed"), 403, "revoked membership blocks the employee");
      const afterRevocation = await snapshot(attacker.org.id);
      assert.deepEqual(afterRevocation.performanceOneOnOneActionItems,
        beforeRevocation.performanceOneOnOneActionItems);
      assert.deepEqual(afterRevocation.performanceOneOnOneActionItemEvents,
        beforeRevocation.performanceOneOnOneActionItemEvents);
      assert.deepEqual(afterRevocation.auditEvents, beforeRevocation.auditEvents);
      checks++;
    }

    // An injected failure at audit INSERT must roll back BOTH the status and
    // the action-item event; no success body is permitted without audit.
    // This trigger exists only inside the disposable fictional PG16 instance.
    const failOrgId = victim.org.id;
    assert.ok(Number.isSafeInteger(failOrgId) && failOrgId > 0);
    const fn = "qa_action_item_audit_abort";
    await pool.query("CREATE FUNCTION " + fn +
      "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = " +
      failOrgId + " AND NEW.action = 'Employee completed 1:1 action item' " +
      "THEN RAISE EXCEPTION 'QA_ACTION_ITEM_AUDIT_ABORT'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER qa_action_item_audit_abort_trigger BEFORE INSERT " +
      "ON audit_events FOR EACH ROW EXECUTE FUNCTION " + fn + "()");
    try {
      const before = await snapshot(victim.org.id);
      const response = await patch(victim.self.cookie,
        victim.items.rollback.id, "completed");
      expectStatus(response, 500, "injected audit failure is not a successful PATCH");
      const after = await snapshot(victim.org.id);
      assert.deepEqual(after, before, "audit insertion error rolls back status and event");
      checks++;
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS qa_action_item_audit_abort_trigger ON audit_events");
      await pool.query("DROP FUNCTION IF EXISTS qa_action_item_audit_abort()");
    }

    assert.deepEqual(await snapshot(victim.org.id), victimBaseline,
      "victim data and audit unchanged after all foreign and forged requests");
    console.log(JSON.stringify({ family: "ESS-PERF-1TO1", method: "PATCH",
      checks, fictionalEmployers: 3, genuineHigherIdVictim: true,
      realOwnStatusTransitions: true, repeatedAndConcurrentCompletionGuard: true,
      foreignAndPeerDenials: true, forgedSelectorsDeniedOrIgnored: true,
      revokedMembershipDenied: true, eventAuditAtomicity: true,
      victimDatabaseUnchanged: true, postgresMajor: 16,
      productionTested: false, creditedMethods: 0, certified: false }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("/tenant-self-action-items-http.mjs")) {
  proveSelfActionItemsHttp().catch(error => {
    console.error("ACTION_ITEMS_TEST_FAILED:", error);
    process.exitCode = 1;
  });
}
