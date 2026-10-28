/**
 * Real signed-in HTTP PATCH isolation for Performance policy governance.
 * Fresh fictional PostgreSQL 16, a production-mode localhost Next server,
 * two independent owner attackers and one genuine higher-ID victim.
 * No scheduler, provider, payroll run or production feature is activated.
 *
 * Dedicated GitHub Actions command:
 *   node --import tsx scripts/qa/tenant-performance-governance-http.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  requireDisposablePerformancePolicyEnv, reminderView, evidenceView,
  proveOwnedPerformanceRead, assertTenantStateUnchanged,
  proveOwnPolicyTransition,
} from "./tenant-performance-governance-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const ROUTE = "/api/performance/follow-through-governance";

async function ready(proc, log) {
  for (let i = 0; i < 65; i++) {
    if (proc.exitCode !== null) throw new Error("Disposable Next exited before ready: " + log());
    try {
      const res = await fetch(BASE + "/login", { cache: "no-store", redirect: "manual" });
      if (res.ok) return;
    } catch { /* the localhost-only server is still booting */ }
    await delay(1000);
  }
  throw new Error("Disposable Next never became ready: " + log());
}
async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([new Promise(resolve => proc.once("exit", resolve)), delay(4000)]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

export async function verifyPerformancePolicyTenantHttp() {
  // The very first application action must be a fail-closed disposable guard.
  requireDisposablePerformancePolicyEnv();

  const [{ db, pool }, s, { asc, eq }, http, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../../src/db/index.ts"),
      import("../../src/db/schema.ts"),
      import("drizzle-orm"),
      import("./tenant-table-http.mjs"),
      import("./tenant-table-invariants.mjs"),
    ]);
  let server;
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
      "PERFORMANCE_POLICY_REFUSED: no existing employer may exist");
    assert.equal((await db.select({ id: s.auditEvents.id })
      .from(s.auditEvents).limit(1)).length, 0,
      "PERFORMANCE_POLICY_REFUSED: audit must initially be empty");

    // Attacker A, attacker B, then victim: persisted IDs must not be guessed.
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      const [cycle] = await db.insert(s.performanceCycles).values({
        organizationId: e.org.id, name: e.marker + " fictional review cycle",
        startDate: "2026-01-01", endDate: "2026-10-31", status: "draft",
        createdByUserId: e.owner.id, createdBy: e.owner.name,
      }).returning();
      const [reminder] = await db.insert(s.performanceActionReminderPolicies).values({
        organizationId: e.org.id, version: 1, enabled: true,
        reminderDaysBefore: 2 + e.rank, escalationDaysOverdue: 3 + e.rank,
        notifyManagerOnEmployeeItem: true, notifyPeopleAdminOnEscalation: true,
        updatedByUserId: e.owner.id, updatedByName: e.owner.name,
      }).returning();
      const [evidence] = await db.insert(s.performanceEvidencePolicies).values({
        organizationId: e.org.id, version: 1, retentionYears: 3 + e.rank,
        autoSealCompletedCycles: true, allowPostSealAmendments: true,
        updatedByUserId: e.owner.id, updatedByName: e.owner.name,
      }).returning();
      // A genuinely signed-in nonadmin worker must also fail on their own tenant.
      const [workerLogin] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-worker@example.invalid",
        name: e.marker + " worker", role: "employee",
        employeeId: e.worker.id, passwordHash: "fictional-employee-only",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: workerLogin.id, organizationId: e.org.id,
        role: "employee", workerEmployeeId: e.worker.id, active: true,
      });
      const workerSession = await http.standaloneMakeSession(workerLogin.id);
      employers.push({
        label, marker: e.marker, orgId: e.org.id, cycleId: cycle.id,
        cycleName: cycle.name, reminderPolicyId: reminder.id,
        evidencePolicyId: evidence.id, ownerId: e.owner.id,
        ownerName: e.owner.name, ownerCookie: e.cookie, workerCookie: workerSession.cookie,
        workerId: e.worker.id, nextReminderDays: 4 + e.rank,
        nextEscalationDays: 8 + e.rank, nextRetentionYears: 8 + e.rank,
      });
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const field of ["orgId", "workerId", "cycleId", "reminderPolicyId", "evidencePolicyId"]) {
        assert.ok(victim[field] > attacker[field],
          "victim's actual " + field + " must be higher than both attacker IDs");
      }
    }

    const tables = Object.freeze({
      staff: s.employees, entities: s.legalEntities,
      cycles: s.performanceCycles,
      reminder: s.performanceActionReminderPolicies,
      reminderEvents: s.performanceActionReminderPolicyEvents,
      evidence: s.performanceEvidencePolicies,
      evidenceEvents: s.performanceEvidencePolicyEvents,
      tasks: s.performanceActionItemReminderTasks,
      seals: s.performanceCycleEvidenceSeals,
      amendments: s.performanceCycleEvidenceAmendments,
      payroll: s.payrollRuns,
    });
    const snapshot = async orgId => {
      const result = {
        org: await db.select().from(s.organizations)
          .where(eq(s.organizations.id, orgId)).orderBy(asc(s.organizations.id)),
      };
      for (const [name, table] of Object.entries(tables)) {
        result[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      const audits = await db.select().from(s.auditEvents)
        .where(eq(s.auditEvents.organizationId, orgId)).orderBy(asc(s.auditEvents.id));
      result.audit = auditBusinessSnapshot(audits);
      return result;
    };
    const request = (actor, method = "GET", body, orgId = actor.orgId, worker = false) =>
      http.standaloneRequest(
        ROUTE + (method === "GET" ? "?organizationId=" + orgId : ""),
        { method, cookie: worker ? actor.workerCookie : actor.ownerCookie, body });
    const patch = (actor, action, orgId = actor.orgId, worker = false, override = {}) =>
      request(actor, "PATCH", action === "action_reminder_policy" ? {
        organizationId: orgId, action, expectedVersion: 1,
        enabled: false, reminderDaysBefore: actor.nextReminderDays,
        escalationDaysOverdue: actor.nextEscalationDays,
        notifyManagerOnEmployeeItem: false, notifyPeopleAdminOnEscalation: false,
        ...override,
      } : {
        organizationId: orgId, action, expectedVersion: 1,
        retentionYears: actor.nextRetentionYears,
        autoSealCompletedCycles: false, allowPostSealAmendments: false,
        ...override,
      }, orgId, worker);
    const deny = (res, expectedStatus, label) => {
      assert.equal(res.status, expectedStatus,
        label + ": expected " + expectedStatus + " got " + res.status +
          " " + res.text.slice(0, 150));
      assert.ok(!res.text.includes(victim.marker), label + ": victim data leaked");
      assert.ok(!res.text.includes(victim.cycleName), label + ": victim cycle leaked");
      assert.ok(!res.text.includes(victim.ownerName), label + ": victim identity leaked");
    };

    server = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
      { env: { ...process.env, DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    const collect = data => { logs = (logs + String(data)).slice(-1800); };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    await ready(server, () => logs);

    const expected = new Map();
    for (const e of employers) expected.set(e.orgId, await snapshot(e.orgId));
    let firstOwn;
    for (const actor of [a, b, victim]) {
      const own = await request(actor);
      proveOwnedPerformanceRead(own, actor, expected.get(actor.orgId));
      if (actor !== victim) assert.ok(!own.text.includes(victim.marker),
        "owned positive must not leak a separate employer's marker");
      if (firstOwn && actor === b) {
        assert.throws(() => proveOwnedPerformanceRead(firstOwn, b,
          expected.get(b.orgId)), "first owner's real GET may never count as B's proof");
      }
      firstOwn ??= own;
    }

    // Two unrelated real owner logins must be denied the higher-ID victim's
    // organization; owner-role login alone is NOT cross-employer permission.
    let foreignGetDenials = 0, foreignPatchDenials = 0;
    let roleDenials = 0, forgedCycleDenials = 0, staleVersionDenials = 0;
    for (const actor of [a, b]) {
      deny(await request(actor, "GET", undefined, victim.orgId), 403,
        actor.label + " foreign employer GET");
      foreignGetDenials++;
      deny(await request(actor, "GET", undefined, actor.orgId, true), 403,
        actor.label + " worker GET");
      roleDenials++;
      for (const action of ["action_reminder_policy", "evidence_policy"]) {
        deny(await patch(actor, action, victim.orgId), 403,
          actor.label + " foreign employer PATCH " + action);
        foreignPatchDenials++;
        deny(await patch(actor, action, actor.orgId, true), 403,
          actor.label + " nonadmin worker PATCH " + action);
        roleDenials++;
      }
      // After an authorized owner check on the attacker's own organization,
      // the real victim's higher-ID cycle cannot be adopted into it.
      deny(await request(actor, "PATCH", {
        organizationId: actor.orgId, action: "seal_cycle",
        cycleId: victim.cycleId,
      }), 404, actor.label + " forged victim cycle ID");
      forgedCycleDenials++;
      // Successful denied requests must leave ALL owners' real policy, worker,
      // performance cycle, payroll and audit rows unchanged.
      for (const e of employers) {
        assertTenantStateUnchanged(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " all pre-mutation denials on " + e.label);
      }
    }

    // For every employer, apply both bounded policy actions with a real DB
    // version transition and independent exact actor/audit/event assertions.
    let ownReminderWrites = 0, ownEvidenceWrites = 0;
    for (const actor of employers) {
      for (const [action, kind] of [
        ["action_reminder_policy", "reminder"],
        ["evidence_policy", "evidence"],
      ]) {
        const before = await snapshot(actor.orgId);
        assertTenantStateUnchanged(expected.get(actor.orgId), before,
          actor.label + " original policy state before " + action);
        const response = await patch(actor, action);
        const after = await snapshot(actor.orgId);
        proveOwnPolicyTransition(before, after, actor, kind, response);
        expected.set(actor.orgId, after);
        if (kind === "reminder") ownReminderWrites++;
        else ownEvidenceWrites++;

        // Stale expectedVersion=1 must return 409 and not make another update.
        deny(await patch(actor, action), 409,
          actor.label + " stale policy version after " + action);
        staleVersionDenials++;
        assertTenantStateUnchanged(after, await snapshot(actor.orgId),
          actor.label + " stale policy PATCH must not update anything");

        for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
          assertTenantStateUnchanged(expected.get(other.orgId),
            await snapshot(other.orgId),
            actor.label + " legitimate " + action + " must not change " + other.label);
        }
      }
      const ownAfter = await request(actor);
      proveOwnedPerformanceRead(ownAfter, actor, expected.get(actor.orgId));
      if (actor !== victim) assert.ok(!ownAfter.text.includes(victim.marker),
        "post-update GET must not reveal victim rows");
    }

    for (const e of employers) {
      assertTenantStateUnchanged(expected.get(e.orgId), await snapshot(e.orgId),
        "final all-tenant business/audit snapshot for " + e.label);
    }
    assert.deepEqual({
      foreignGetDenials, foreignPatchDenials, roleDenials,
      forgedCycleDenials, staleVersionDenials,
      ownReminderWrites, ownEvidenceWrites,
    }, {
      foreignGetDenials: 2, foreignPatchDenials: 4, roleDenials: 6,
      forgedCycleDenials: 2, staleVersionDenials: 6,
      ownReminderWrites: 3, ownEvidenceWrites: 3,
    });
    console.log(JSON.stringify({
      kind: "tenant-performance-governance-policies-pg16-http",
      exactGapMethod: "PATCH performance/follow-through-governance",
      actions: ["action_reminder_policy", "evidence_policy"],
      realHigherIdVictim: true, independentOwnerAttackers: 2,
      populatedOwnCompanyReads: 6,
      foreignGetDenials, foreignPatchDenials, roleDenials,
      forgedCycleDenials, staleVersionDenials,
      persistedOwnPolicyWrites: ownReminderWrites + ownEvidenceWrites,
      eventAndAuditBoundToActor: true, payrollUnchanged: true,
      otherActionsProved: false, productionCertified: false, coverageCredits: 0,
    }));
  } finally {
    await stop(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-performance-governance-http.mjs")) {
  verifyPerformancePolicyTenantHttp().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
