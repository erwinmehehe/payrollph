/**
 * WRK-02: real own/create+update and foreign/forged-denial proof for
 * POST /api/workforce-planning/demand-handoff.
 *
 * Fictional PG16 + isolated production-mode Next HTTP only. No connected
 * providers, payroll mutations, release action or new coverage credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  HANDOFF_PATH, HANDOFF_DATE, MANUAL_DATE,
  requireDisposableHandoffEnv, assertDeniedHandoff,
  assertImmutableHandoffState, assertOwnedHandoffWrite,
} from "./tenant-wfp-demand-handoff-contract.mjs";

const ROOT = "http://127.0.0.1:3000";
const plain = value => JSON.parse(JSON.stringify(value));

async function launchServer() {
  const server = spawn(process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let output = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", chunk => { output = (output + String(chunk)).slice(-2200); });
  }
  for (let attempt = 0; attempt < 75; attempt++) {
    if (server.exitCode !== null) throw new Error("Disposable Next exited: " + output);
    try {
      const result = await fetch(ROOT + "/login", { redirect: "manual", cache: "no-store" });
      if (result.ok) return server;
    } catch { /* localhost production app has not started yet */ }
    await delay(1000);
  }
  server.kill("SIGTERM");
  throw new Error("Local Next did not become ready: " + output);
}
async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(4000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export async function proveWfpDemandHandoff() {
  // Refuse production DB, network app origin, enabled money/provider flags,
  // live secrets or a non-CI session BEFORE any DB or application import.
  requireDisposableHandoffEnv();
  const [{ db, pool }, s, { eq, asc }, http, { auditBusinessSnapshot }] =
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
    "HANDOFF_REFUSED: only a fresh empty disposable employer database is allowed");
    assert.equal((await db.select({ id: s.auditEvents.id })
      .from(s.auditEvents).limit(1)).length, 0,
    "HANDOFF_REFUSED: no preexisting audit/business rows are allowed");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      const planName = e.marker + " plan";
      const [plan] = await db.insert(s.workforcePlans).values({
        organizationId: e.org.id, name: planName,
        startDate: "2099-01-01", endDate: "2099-12-31",
        budget: "100000.00", status: "approved",
        createdByUserId: e.owner.id, createdBy: e.owner.name,
      }).returning();
      const jobTitle = e.marker + " job";
      const [job] = await db.insert(s.jobProfiles).values({
        organizationId: e.org.id, title: jobTitle,
        family: "General", level: "Individual Contributor", active: true,
      }).returning();
      const siteName = e.marker + " site";
      const shiftCode = (e.marker + "-SHIFT").slice(0, 32);
      // The production route joins these four names into audit_events.resource (varchar 160).
      // Keep all distinct fictional employer markers while fitting the actual schema.
      assert.ok([planName, jobTitle, siteName, shiftCode].join(" · ").length <= 160,
        "HANDOFF_REFUSED: synthetic audit resource exceeds the real PostgreSQL column");
      const [site] = await db.insert(s.worksites).values({
        organizationId: e.org.id, orgUnitId: e.unit.id,
        code: (e.marker + "-SITE").slice(0, 32),
        name: siteName,
        timezone: "Asia/Manila", active: true,
      }).returning();
      const [shift] = await db.insert(s.shiftDefinitions).values({
        organizationId: e.org.id, code: shiftCode,
        name: e.marker + " own early shift",
        startTime: "08:00", endTime: "17:00", active: true,
      }).returning();
      const positionIds = [];
      for (const idx of [1, 2]) {
        const [position] = await db.insert(s.positions).values({
          organizationId: e.org.id,
          code: (e.marker + "-POSITION-" + idx).slice(0, 48),
          jobProfileId: job.id, planId: plan.id,
          orgUnitId: e.unit.id, legalEntityId: e.entity.id,
          status: idx === 1 ? "approved" : "open",
          createdByUserId: e.owner.id,
        }).returning();
        positionIds.push(position.id);
      }
      const [manual] = await db.insert(s.staffingRequirements).values({
        organizationId: e.org.id, worksiteId: site.id,
        workDate: MANUAL_DATE, shiftDefinitionId: shift.id,
        jobProfileId: job.id, requiredHeadcount: 1, sourceType: "manual",
        notes: e.marker + " protected manual staffing requirement",
        createdBy: e.owner.name, createdByUserId: e.owner.id,
      }).returning();
      const [nonadmin] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-employee@example.invalid",
        name: e.marker + " nonadmin worker", role: "employee",
        employeeId: e.worker.id, passwordHash: "fictional-session-only",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: nonadmin.id, organizationId: e.org.id,
        role: "employee", active: true, workerEmployeeId: e.worker.id,
      });
      const employeeSession = await http.standaloneMakeSession(nonadmin.id);
      employers.push({
        label, marker: e.marker,
        orgId: e.org.id, ownerId: e.owner.id, ownerName: e.owner.name,
        ownerCookie: e.cookie, employeeCookie: employeeSession.cookie,
        planId: plan.id, planName, jobId: job.id, jobTitle,
        siteId: site.id, siteName, shiftId: shift.id, shiftCode, positionIds,
        manualRequirementId: manual.id,
      });
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const field of ["orgId", "planId", "siteId", "jobId", "shiftId", "manualRequirementId"]) {
        assert.ok(victim[field] > attacker[field],
          "Real persisted higher-ID victim required: " + field);
      }
      assert.ok(victim.positionIds[0] > attacker.positionIds[1],
        "Victim position ids must be genuinely higher than both attacker position ids");
    }

    const scopedTables = Object.freeze([
      "organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "workforcePlans", "worksites", "jobProfiles",
      "shiftDefinitions", "positions", "positionAssignments", "staffingRequirements",
      "payrollRuns", "timePunches", "outbox", "auditEvents",
    ]);
    const snapshot = async orgId => {
      const state = {};
      for (const name of scopedTables) {
        const table = s[name];
        assert.ok(table?.id, "Required real SQL table missing: " + name);
        const selector = name === "organizations" ? eq(table.id, orgId)
          : eq(table.organizationId, orgId);
        const rows = await db.select().from(table).where(selector).orderBy(asc(table.id));
        state[name] = name === "auditEvents" ? auditBusinessSnapshot(rows) : rows;
      }
      return plain(state);
    };
    const freezeAll = async () => new Map(await Promise.all(employers.map(async actor =>
      [actor.orgId, await snapshot(actor.orgId)])));
    const assertOthersUnchanged = async (before, label) => {
      for (const actor of employers) {
        assertImmutableHandoffState(before.get(actor.orgId), await snapshot(actor.orgId),
          label + " preserved " + actor.marker);
      }
    };
    const bodyFor = (actor, override = {}) => ({
      organizationId: actor.orgId,
      planId: actor.planId, jobProfileId: actor.jobId,
      worksiteId: actor.siteId, shiftDefinitionId: actor.shiftId,
      requiredHeadcount: 1, startDate: HANDOFF_DATE, endDate: HANDOFF_DATE,
      ...override,
    });
    const post = (actor, body, employee = false) =>
      http.standaloneRequest(HANDOFF_PATH, { method: "POST",
        cookie: employee ? actor.employeeCookie : actor.ownerCookie, body });

    server = await launchServer();
    assert.equal(process.env.TENANT_TABLE_PROFILE, "default");
    let foreignDenials = 0, forgedIdDenials = 0, roleDenials = 0;
    let planCapDenials = 0, manualOverwriteDenials = 0;
    for (const attacker of [a, b]) {
      const cases = [
        ["foreign employer selector", bodyFor(victim), 403, "foreign"],
        ["foreign plan under own employer", bodyFor(attacker, { planId: victim.planId }), 409, "forged"],
        ["foreign job profile under own employer", bodyFor(attacker, { jobProfileId: victim.jobId }), 404, "forged"],
        ["foreign worksite under own employer", bodyFor(attacker, { worksiteId: victim.siteId }), 404, "forged"],
        ["foreign shift under own employer", bodyFor(attacker, { shiftDefinitionId: victim.shiftId }), 404, "forged"],
        ["unapproved three-worker demand", bodyFor(attacker, { requiredHeadcount: 3 }), 409, "cap"],
        ["manual requirement cannot be overwritten", bodyFor(attacker, {
          startDate: MANUAL_DATE, endDate: MANUAL_DATE }), 409, "manual"],
        ["out-of-plan scheduling", bodyFor(attacker, {
          startDate: "2098-05-20", endDate: "2098-05-20" }), 409, "cap"],
      ];
      for (const [label, body, status, kind] of cases) {
        const before = await freezeAll();
        const denied = await post(attacker, body);
        assertDeniedHandoff(denied, status, [victim.marker, victim.planName],
          attacker.marker + " " + label);
        await assertOthersUnchanged(before, label);
        if (kind === "foreign") foreignDenials++;
        if (kind === "forged") forgedIdDenials++;
        if (kind === "cap") planCapDenials++;
        if (kind === "manual") manualOverwriteDenials++;
      }
      const before = await freezeAll();
      assertDeniedHandoff(await post(attacker, bodyFor(attacker), true), 403,
        [victim.marker], attacker.marker + " nonadmin employee");
      await assertOthersUnchanged(before, "nonadmin denial");
      roleDenials++;
    }

    let legitimateCreates = 0, legitimateUpdates = 0;
    let firstOwnReceipt;
    for (const actor of employers) {
      const before = await freezeAll();
      const receipt = await post(actor, bodyFor(actor));
      const after = await snapshot(actor.orgId);
      const rowId = assertOwnedHandoffWrite({
        before: before.get(actor.orgId), after, actor, response: receipt,
        action: "created", headcount: 1,
        foreignMarkers: employers.filter(other => other !== actor).map(other => other.marker),
      });
      if (actor === a) firstOwnReceipt = { before: before.get(actor.orgId),
        after, actor, response: receipt, action: "created", headcount: 1 };
      actor.ownRequirementId = rowId;
      for (const other of employers.filter(other => other !== actor)) {
        assertImmutableHandoffState(before.get(other.orgId), await snapshot(other.orgId),
          "Own creation must not mutate " + other.marker);
      }
      legitimateCreates++;
    }
    assert.throws(() => assertOwnedHandoffWrite({ ...firstOwnReceipt, actor: b }),
      "A genuinely distinct own-response identity is required, not vacuous 201");

    for (const actor of employers) {
      const before = await freezeAll();
      const receipt = await post(actor, bodyFor(actor, { requiredHeadcount: 2 }));
      const after = await snapshot(actor.orgId);
      const rowId = assertOwnedHandoffWrite({
        before: before.get(actor.orgId), after, actor, response: receipt,
        action: "updated", headcount: 2,
        foreignMarkers: employers.filter(other => other !== actor).map(other => other.marker),
      });
      assert.equal(rowId, actor.ownRequirementId, "Existing own staffing ID must be reused");
      for (const other of employers.filter(other => other !== actor)) {
        assertImmutableHandoffState(before.get(other.orgId), await snapshot(other.orgId),
          "Own update must not mutate " + other.marker);
      }
      legitimateUpdates++;
    }

    assert.deepEqual({
      foreignDenials, forgedIdDenials, roleDenials,
      planCapDenials, manualOverwriteDenials, legitimateCreates, legitimateUpdates,
    }, {
      foreignDenials: 2, forgedIdDenials: 8, roleDenials: 2,
      planCapDenials: 4, manualOverwriteDenials: 2,
      legitimateCreates: 3, legitimateUpdates: 3,
    });
    console.log(JSON.stringify({
      proof: "wfp-demand-handoff-post-real-http-disposable-pg16",
      route: "POST workforce-planning/demand-handoff",
      twoIndependentAttackers: true, genuinelyHigherIdVictim: true,
      legitimateCreates, legitimateUpdates, foreignDenials, forgedIdDenials,
      roleDenials, planCapDenials, manualOverwriteDenials,
      explicitOwnResponseDiscrimination: true, persistedDatabaseIdentity: true,
      unchangedEveryEmployerAndAuditForDenials: true,
      unchangedOtherEmployerOnEverySuccess: true,
      providersDisabled: true, payrollWrites: false,
      methodAccepted: false, productionCertified: false, newCredits: 0,
    }));
  } finally {
    await stopServer(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-wfp-demand-handoff-http.mjs")) {
  proveWfpDemandHandoff().catch(error => { console.error(error); process.exitCode = 1; });
}
