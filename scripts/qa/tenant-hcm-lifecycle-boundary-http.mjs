/**
 * Real signed-in GET/PATCH lifecycle notification proof against a throwaway
 * PostgreSQL 16 database and production-mode localhost Next.js.
 * No providers, live people, payroll actions, or method credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableLifecycleBoundary, requirePrivateNoLeak, requireOneTaskTransition,
} from "./tenant-hcm-lifecycle-boundary-contract.mjs";

requireDisposableLifecycleBoundary(); // This MUST precede all database/app imports.

export async function verifyHcmLifecycleBoundaryHttp() {
  const [storage, schema, orm, fixture, veto] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("./disposable-insert-veto.mjs"),
  ]);
  const { db, pool } = storage;
  const { organizations, employees, userOrganizations, users, sessions,
    hcmLifecycleNotificationTasks: tasks, hcmLifecycleNotificationEvents: events,
    auditEvents, payrollRuns } = schema;
  const { eq, asc } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const { withDisposableInsertVeto } = veto;
  const ENDPOINT = "/api/hcm/lifecycle-notifications";
  try {
    for (const [name, table] of [["organizations", organizations], ["tasks", tasks],
      ["events", events], ["audit", auditEvents]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "HCM_LIFECYCLE_BOUNDARY_REFUSED: empty fictional table required: " + name);
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    for (let i = 0; i < 7; i++) await seedEmployer("FILL", nonce + i, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, 6));

    const managers = [];
    for (const e of [a, b]) {
      const [manager] = await db.insert(users).values({
        email: "lifecycle-manager-" + e.label.toLowerCase() + "-" + nonce + "@example.invalid",
        name: "Fictional Manager " + e.label, role: "manager",
        passwordHash: "synthetic-session-only", totpEnabled: true,
      }).returning();
      await db.insert(userOrganizations).values({
        userId: manager.id, organizationId: e.org.id, role: "manager",
        orgUnitId: e.unit.id, active: true,
      });
      const session = await standaloneMakeSession(manager.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
      managers.push({ user: manager, cookie: session.cookie });
    }

    async function createTask(e, suffix, extra = {}) {
      const [result] = await db.insert(tasks).values({
        organizationId: e.org.id, employeeId: extra.employeeId ?? e.worker.id,
        ownerUserId: extra.ownerUserId ?? e.owner.id,
        ownerName: e.owner.name, sourceType: "employment_decision",
        sourceKey: e.marker + "-" + suffix,
        action: "review_decision", stage: "probation", severity: "warning",
        title: e.marker + " " + suffix, detail: "Fictional lifecycle evidence only",
        status: "open",
      }).returning();
      return result;
    }
    const owned = new Map();
    for (const e of [a, b]) {
      const rows = {};
      for (const action of ["assign", "snooze", "acknowledge", "dismiss"])
        rows[action] = await createTask(e, action);
      rows.veto = await createTask(e, "audit-veto");
      owned.set(e.org.id, rows);
    }
    for (let i = 0; i < 7; i++) await createTask(a, "id-filler-" + i);
    const foreign = await createTask(victim, "VICTIM-ONLY-SECRET");
    const mismatched = await createTask(a, "mismatched-worker", { employeeId: victim.worker.id });
    assert.ok(foreign.id > Math.max(6,
      ...[...owned.values()].flatMap(rows => Object.values(rows).map(task => task.id))));
    const forbidden = [victim.marker, victim.owner.email, foreign.sourceKey,
      victim.cookie.split("=")[1]];

    async function snapshot(e) {
      const orgId = e.org.id;
      return {
        tasks: await db.select().from(tasks).where(eq(tasks.organizationId, orgId)).orderBy(asc(tasks.id)),
        events: await db.select().from(events).where(eq(events.organizationId, orgId)).orderBy(asc(events.id)),
        audits: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(asc(auditEvents.id)),
        employees: await db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(asc(employees.id)),
        payroll: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollRuns.id)),
      };
    }
    const beforeVictim = await snapshot(victim);
    const get = (cookie, orgId) => standaloneRequest(ENDPOINT + "?organizationId=" + orgId, { cookie });
    const patch = (cookie, body) => standaloneRequest(ENDPOINT, { method: "PATCH", cookie, body });
    let ownPositives = 0, foreignDenials = 0, auditVetoRollbacks = 0;
    for (const [e, manager] of [[a, managers[0]], [b, managers[1]]]) {
      const rows = owned.get(e.org.id);
      const ownGet = await get(e.cookie, e.org.id);
      requirePrivateNoLeak(ownGet, { status: 200, forbidden, label: e.label + " own GET" });
      assert.equal(ownGet.json.organizationId, e.org.id);
      assert.equal(ownGet.json.canAssign, true);
      for (const row of Object.values(rows))
        assert.ok(ownGet.json.tasks.some(item => item.id === row.id &&
          item.organizationId === e.org.id && item.employeeNo === e.worker.employeeNo),
          "nonempty own GET must prove actual persisted own employee records");
      assert.ok(!ownGet.json.tasks.some(item => item.id === foreign.id));
      if (e === a)
        assert.ok(!ownGet.json.tasks.some(item => item.id === mismatched.id),
          "cross-employer employee FK cannot be joined into an attacker task");
      ownPositives++;

      const managerGet = await get(manager.cookie, e.org.id);
      requirePrivateNoLeak(managerGet, { status: 200, forbidden, label: e.label + " assigned manager GET" });
      assert.equal(managerGet.json.canAssign, false);
      assert.ok(managerGet.json.tasks.every(item => item.ownerUserId === manager.user.id),
        "manager must not enumerate tasks outside their assignment");
      ownPositives++;

      requirePrivateNoLeak(await get(e.cookie, victim.org.id), {
        status: 403, forbidden, label: e.label + " forged victim GET",
      }); foreignDenials++;
      requirePrivateNoLeak(await get(manager.cookie, victim.org.id), {
        status: 403, forbidden, label: e.label + " manager forged victim GET",
      }); foreignDenials++;
      requirePrivateNoLeak(await patch(e.cookie, {
        organizationId: victim.org.id, taskId: foreign.id, action: "acknowledge",
      }), { status: 403, forbidden, label: e.label + " victim org PATCH" }); foreignDenials++;
      requirePrivateNoLeak(await patch(e.cookie, {
        organizationId: e.org.id, taskId: foreign.id, action: "acknowledge",
      }), { status: 404, forbidden, label: e.label + " stolen task PATCH" }); foreignDenials++;
      if (e === a) {
        requirePrivateNoLeak(await patch(e.cookie, {
          organizationId: a.org.id, taskId: mismatched.id, action: "acknowledge",
        }), { status: 404, forbidden, label: "mismatched employee FK PATCH" });
        foreignDenials++;
      }
      requirePrivateNoLeak(await patch(e.cookie, {
        organizationId: e.org.id, taskId: rows.assign.id,
        action: "assign", ownerUserId: victim.owner.id,
      }), { status: 400, forbidden, label: "foreign owner assignment refused" });
      foreignDenials++;
      requirePrivateNoLeak(await patch(manager.cookie, {
        organizationId: e.org.id, taskId: rows.assign.id,
        action: "assign", ownerUserId: manager.user.id,
      }), { status: 403, forbidden, label: "manager cannot assign" });
      foreignDenials++;

      for (const action of ["assign", "snooze", "acknowledge", "dismiss"]) {
        const before = await snapshot(e);
        const response = await patch(e.cookie, {
          organizationId: e.org.id, taskId: rows[action].id, action,
          ...(action === "assign" ? { ownerUserId: manager.user.id } : {}),
          ...(action === "snooze" ? { days: 3 } : {}),
          ...(action === "acknowledge" || action === "dismiss" ? { note: "synthetic" } : {}),
          userId: victim.owner.id, employeeId: victim.worker.id, // forged unused selectors
        });
        requirePrivateNoLeak(response, { status: 200, forbidden, label: e.label + " own " + action });
        assert.equal(response.json?.task?.id, rows[action].id);
        assert.equal(response.json.task.organizationId, e.org.id);
        const eventName = action === "assign" ? "assigned" : action === "snooze" ? "snoozed" :
          action === "dismiss" ? "dismissed" : "acknowledged";
        const change = requireOneTaskTransition(before, await snapshot(e),
          rows[action].id, eventName, e.owner);
        assert.equal(change.task.status,
          action === "snooze" ? "snoozed" : ["acknowledge", "dismiss"].includes(action) ? "acknowledged" : "open");
        if (action === "assign") assert.equal(change.task.ownerUserId, manager.user.id);
        ownPositives++;
      }
      const managerOwn = await get(manager.cookie, e.org.id);
      assert.equal(managerOwn.status, 200);
      assert.ok(managerOwn.json.tasks.some(task => task.id === rows.assign.id));
      const managerBefore = await snapshot(e);
      const managerAction = await patch(manager.cookie, {
        organizationId: e.org.id, taskId: rows.assign.id, action: "acknowledge",
      });
      requirePrivateNoLeak(managerAction, { status: 200, forbidden, label: e.label + " manager own PATCH" });
      requireOneTaskTransition(managerBefore, await snapshot(e),
        rows.assign.id, "acknowledged", manager.user);
      ownPositives++;

      for (const action of ["assign", "snooze", "acknowledge", "dismiss"]) {
        const before = await snapshot(e);
        await withDisposableInsertVeto(pool, "audit_events", e.org.id, async () => {
          const denied = await patch(e.cookie, {
            organizationId: e.org.id, taskId: rows.veto.id, action,
            ...(action === "assign" ? { ownerUserId: manager.user.id } : {}),
            ...(action === "snooze" ? { days: 3 } : {}),
          });
          requirePrivateNoLeak(denied, { status: 500, forbidden, label: "audit INSERT veto " + action });
        });
        assert.deepEqual(await snapshot(e), before,
          "no task, event or audit mutation may survive veto on " + action);
        auditVetoRollbacks++;
      }
      assert.deepEqual(await snapshot(victim), beforeVictim,
        "higher-ID victim task, employee, payroll, audit and events must be unchanged");
    }
    const victimOwn = await get(victim.cookie, victim.org.id);
    requirePrivateNoLeak(victimOwn, { status: 200, forbidden: [], label: "genuine victim GET control" });
    assert.ok(victimOwn.json.tasks.some(item =>
      item.id === foreign.id && item.employeeNo === victim.worker.employeeNo),
      "victim own GET must be populated");
    assert.equal((await get(undefined, victim.org.id)).status, 401);
    console.log(JSON.stringify({
      kind: "HCM_LIFECYCLE_BOUNDARY_REAL_HTTP_PG16",
      methods: ["GET", "PATCH"], actions: ["assign", "snooze", "acknowledge", "dismiss"],
      independentAttackers: 2, ownPositives, foreignDenials, auditVetoRollbacks,
      realHigherIdVictim: true, corruptedEmployeeJoinHidden: true,
      persistedVictimStateUnchanged: true, providerCalls: 0,
      coverageCreditsAdded: 0, productionTested: false, independentSecurityReview: "PENDING",
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-hcm-lifecycle-boundary-http.mjs")) {
  verifyHcmLifecycleBoundaryHttp().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
