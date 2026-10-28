/**
 * Independent, zero-credit POST workforce-planning/allocations proof.
 * Executes real signed-in HTTP against a disposable localhost Next server and
 * three seeded, strictly fictional PostgreSQL 16 employers.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import {
  requireDisposablePlanningEnv, assertNoStateChange, assertOwnedPlanningRead,
  assertOwnAllocationCreated, assertOwnManagerDraftCreated,
} from "./tenant-wfp-allocations-contract.mjs";

const ROOT = "http://127.0.0.1:3000";
const PATH = "/api/workforce-planning/allocations";

async function launchServer() {
  const server = spawn(process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", data => { logs = (logs + String(data)).slice(-2000); });
  }
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) throw new Error("Disposable Next terminated: " + logs);
    try {
      const response = await fetch(ROOT + "/login",
        { redirect: "manual", cache: "no-store" });
      if (response.ok) return server;
    } catch { /* localhost server is not ready yet */ }
    await pause(1000);
  }
  server.kill("SIGTERM");
  throw new Error("Disposable localhost Next not ready: " + logs);
}
async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => server.once("exit", resolve)),
    pause(4000),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export async function proveWorkforcePlanningAllocations() {
  requireDisposablePlanningEnv(); // Fail closed BEFORE all database/app imports.
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
    "WFP_ALLOCATION_REFUSED: fresh empty fictional organizations required");
    assert.equal((await db.select({ id: s.auditEvents.id })
      .from(s.auditEvents).limit(1)).length, 0,
    "WFP_ALLOCATION_REFUSED: fresh empty fictional audit required");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      const planName = e.marker + " guarded workforce capacity plan";
      const [plan] = await db.insert(s.workforcePlans).values({
        organizationId: e.org.id, name: planName,
        startDate: "2099-01-01", endDate: "2099-12-31",
        budget: "100000.00", status: "draft",
        createdByUserId: e.owner.id, createdBy: e.owner.name,
      }).returning();
      const [existing] = await db.insert(s.workforcePlanAllocations).values({
        organizationId: e.org.id, planId: plan.id, orgUnitId: e.unit.id,
        headcountCeiling: 2, annualBudgetCeiling: "12000.00",
        notes: e.marker + " prior fictional allocation",
        createdByUserId: e.owner.id, updatedByUserId: e.owner.id,
      }).returning();
      const [secondUnit] = await db.insert(s.orgUnits).values({
        organizationId: e.org.id, legalEntityId: e.entity.id,
        type: "department", code: e.marker.slice(0, 22) + "-EXTRA",
        name: e.marker + " separate planning department", active: true,
      }).returning();
      const [employeeLogin] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-employee@example.invalid",
        name: e.marker + " nonadmin employee", role: "employee",
        employeeId: e.worker.id, passwordHash: "fictional-no-login",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: employeeLogin.id, organizationId: e.org.id,
        role: "employee", active: true,
        workerEmployeeId: e.worker.id,
      });
      const nonadmin = await http.standaloneMakeSession(employeeLogin.id);
      // An independently authenticated company-wide People checker may decide
      // the maker's request, but may not act on a different employer's request.
      const [checker] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-checker@example.invalid",
        name: e.marker + " independent fictional checker",
        role: "owner", passwordHash: "fictional-no-login",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: checker.id, organizationId: e.org.id,
        role: "owner", active: true,
      });
      const checkerSession = await http.standaloneMakeSession(checker.id);
      employers.push({
        label, marker: e.marker,
        orgId: e.org.id, planId: plan.id, planName,
        ownerId: e.owner.id, ownerName: e.owner.name,
        ownerCookie: e.cookie, employeeCookie: nonadmin.cookie,
        checkerCookie: checkerSession.cookie, checkerId: checker.id,
        checkerName: checker.name,
        existingAllocationId: existing.id, firstUnitId: e.unit.id,
        newUnitId: secondUnit.id, newUnitName: secondUnit.name,
        headcount: 3 + e.rank, budget: 20000 + e.rank * 1000,
        planBudget: Number(plan.budget),
        notes: e.marker + " allowed fictional allocation",
        requestHeadcount: 2,
        requestBudget: 6000 + e.rank * 100,
        rationale: e.marker + " capacity request with fictional demand evidence",
      });
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const key of ["orgId", "planId", "newUnitId", "existingAllocationId"]) {
        assert.ok(victim[key] > attacker[key],
          "higher-ID victim must have a real persisted " + key);
      }
    }

    const tableNames = Object.freeze({
      entities: s.legalEntities, units: s.orgUnits, staff: s.employees,
      payProfiles: s.employeePayProfiles,
      plans: s.workforcePlans, allocations: s.workforcePlanAllocations,
      submissions: s.workforcePlanManagerSubmissions,
      scenarios: s.workforcePlanningScenarios,
      payroll: s.payrollRuns, punches: s.timePunches,
    });
    const snapshot = async orgId => {
      const result = {
        organization: await db.select().from(s.organizations)
          .where(eq(s.organizations.id, orgId)).orderBy(asc(s.organizations.id)),
      };
      for (const [key, table] of Object.entries(tableNames)) {
        result[key] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      const audit = await db.select().from(s.auditEvents)
        .where(eq(s.auditEvents.organizationId, orgId)).orderBy(asc(s.auditEvents.id));
      result.audits = auditBusinessSnapshot(audit);
      return result;
    };
    const get = (actor, orgId = actor.orgId, nonadmin = false) =>
      http.standaloneRequest(PATH + "?organizationId=" + orgId,
        { cookie: nonadmin ? actor.employeeCookie : actor.ownerCookie });
    const post = (actor, payload, nonadmin = false) =>
      http.standaloneRequest(PATH, { method: "POST",
        cookie: nonadmin ? actor.employeeCookie : actor.ownerCookie, body: payload });
    const patch = (actor, submissionId, action,
      { checker = false, nonadmin = false, orgId = actor.orgId } = {}) =>
      http.standaloneRequest(PATH, {
        method: "PATCH",
        cookie: checker ? actor.checkerCookie
          : nonadmin ? actor.employeeCookie : actor.ownerCookie,
        body: {
          organizationId: orgId, submissionId, action,
          decisionNote: actor.marker + " fictional independent decision note",
        },
      });
    const allocationBody = (actor, orgId = actor.orgId, planId = actor.planId,
      orgUnitId = actor.newUnitId, budget = actor.budget) => ({
      organizationId: orgId, entityType: "allocation", planId, orgUnitId,
      headcountCeiling: actor.headcount, annualBudgetCeiling: budget, notes: actor.notes,
    });
    const submissionBody = (actor, allocationId, orgId = actor.orgId) => ({
      organizationId: orgId, entityType: "submission",
      allocationId, requestedHeadcount: actor.requestHeadcount,
      requestedAnnualBudget: actor.requestBudget, rationale: actor.rationale,
    });
    const deny = (response, status, label) => {
      assert.equal(response.status, status,
        label + ": expected HTTP " + status + " but received " + response.status +
        " " + response.text.slice(0, 180));
      assert.ok(!response.text.includes(victim.marker), label + ": victim marker leaked");
      assert.ok(!response.text.includes(victim.planName), label + ": victim plan leaked");
    };
    const assertDecisionTransition = (before, after, actor, submissionId, status, response) => {
      assert.equal(response.status, 200,
        actor.label + " own " + status + " expected 200: " + response.text.slice(0, 180));
      const original = before.submissions.find(row => row.id === submissionId);
      const changed = after.submissions.find(row => row.id === submissionId);
      assert.ok(original && changed, "real persisted manager request must exist");
      assert.equal(original.organizationId, actor.orgId);
      assert.equal(changed.organizationId, actor.orgId);
      assert.equal(changed.planId, actor.planId);
      assert.equal(changed.allocationId, actor.newAllocationId);
      assert.equal(changed.status, status);
      assert.equal(response.json?.submission?.id, submissionId);
      assert.equal(response.json?.submission?.organizationId, actor.orgId);
      assert.equal(response.json?.submission?.status, status);
      if (status === "submitted") {
        assert.equal(changed.submittedByUserId, actor.ownerId);
      } else {
        assert.equal(changed.decidedByUserId, actor.checkerId);
        assert.equal(changed.submittedByUserId, actor.ownerId,
          "maker/checker identities must remain independent");
      }
      assert.equal(after.submissions.length, before.submissions.length,
        "PATCH must never create another submission");
      assert.deepEqual(after.submissions.filter(row => row.id !== submissionId),
        before.submissions.filter(row => row.id !== submissionId),
        "PATCH cannot modify another manager request");
      for (const key of ["organization", "entities", "units", "staff",
        "payProfiles", "plans", "allocations", "scenarios", "payroll", "punches"]) {
        assert.deepEqual(after[key], before[key],
          "PATCH must not alter unrelated " + key + " state");
      }
      assert.equal(after.audits.length, before.audits.length + 1,
        "successful PATCH must emit one actual scoped audit row");
      assert.deepEqual(after.audits.slice(0, -1), before.audits);
      const audit = after.audits.at(-1);
      assert.equal(audit.organizationId, actor.orgId);
      assert.equal(audit.actor, status === "submitted" ? actor.ownerName : actor.checkerName);
      assert.equal(audit.action, "Workforce manager request " + status);
      assert.equal(audit.metadata?.submissionId, submissionId);
      assert.equal(audit.metadata?.allocationId, actor.newAllocationId);
    };
    server = await launchServer();
    const expected = new Map();
    for (const e of employers) expected.set(e.orgId, await snapshot(e.orgId));

    // Real populated own positives for A, B and victim before any mutations.
    let aRealOwnedGet;
    for (const e of employers) {
      const owned = await get(e);
      assertOwnedPlanningRead(owned, e, expected.get(e.orgId));
      if (e !== victim) assert.ok(!owned.text.includes(victim.marker));
      if (e === a) aRealOwnedGet = owned;
      if (e === b) {
        assert.throws(() => assertOwnedPlanningRead(aRealOwnedGet, b,
          expected.get(b.orgId)), "A's real 200 must fail B's own-row assertion");
      }
    }

    let foreignGets = 0, foreignPosts = 0, forgedPlanOrUnit = 0;
    let forgedAllocation = 0, nonadminDenials = 0, budgetDenials = 0;
    for (const actor of [a, b]) {
      deny(await get(actor, victim.orgId), 403, actor.label + " foreign GET");
      foreignGets++;
      deny(await post(actor, allocationBody(actor, victim.orgId,
        victim.planId, victim.newUnitId)), 403,
        actor.label + " foreign owner allocation create");
      foreignPosts++;
      deny(await post(actor, submissionBody(actor,
        victim.existingAllocationId, victim.orgId)), 403,
        actor.label + " foreign manager draft create");
      foreignPosts++;
      deny(await post(actor, allocationBody(actor,
        actor.orgId, victim.planId, actor.newUnitId)), 404,
        actor.label + " foreign plan with own organization");
      forgedPlanOrUnit++;
      deny(await post(actor, allocationBody(actor,
        actor.orgId, actor.planId, victim.newUnitId)), 404,
        actor.label + " foreign org unit with own plan");
      forgedPlanOrUnit++;
      deny(await post(actor, submissionBody(actor,
        victim.existingAllocationId)), 404,
        actor.label + " foreign allocation with own organization");
      forgedAllocation++;
      deny(await get(actor, actor.orgId, true), 403,
        actor.label + " nonadmin employee GET");
      nonadminDenials++;
      deny(await post(actor, allocationBody(actor), true), 403,
        actor.label + " nonadmin employee POST");
      nonadminDenials++;
      deny(await post(actor, allocationBody(actor,
        actor.orgId, actor.planId, actor.newUnitId, 999999)), 409,
        actor.label + " allocation greater than published plan budget");
      budgetDenials++;
      for (const e of employers) {
        assertNoStateChange(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " failed requests left " + e.label + " unchanged");
      }
    }

    let ownAllocations = 0, ownDrafts = 0;
    for (const actor of employers) {
      const beforeAllocation = await snapshot(actor.orgId);
      assertNoStateChange(expected.get(actor.orgId), beforeAllocation,
        actor.label + " pre-allocation state");
      const createAllocation = await post(actor, allocationBody(actor));
      const afterAllocation = await snapshot(actor.orgId);
      const allocationId = assertOwnAllocationCreated(
        beforeAllocation, afterAllocation, actor, createAllocation);
      actor.newAllocationId = allocationId;
      ownAllocations++;
      expected.set(actor.orgId, afterAllocation);
      for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
        assertNoStateChange(expected.get(other.orgId), await snapshot(other.orgId),
          actor.label + " allocation write did not touch " + other.label);
      }

      const beforeDraft = await snapshot(actor.orgId);
      const createDraft = await post(actor, submissionBody(actor, allocationId));
      const afterDraft = await snapshot(actor.orgId);
      actor.draftId = assertOwnManagerDraftCreated(beforeDraft, afterDraft, actor,
        allocationId, createDraft);
      ownDrafts++;
      expected.set(actor.orgId, afterDraft);
      for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
        assertNoStateChange(expected.get(other.orgId), await snapshot(other.orgId),
          actor.label + " submission write did not touch " + other.label);
      }
      const ownAfter = await get(actor);
      assertOwnedPlanningRead(ownAfter, actor, expected.get(actor.orgId));
      if (actor !== victim) assert.ok(!ownAfter.text.includes(victim.marker));
    }
    // Real, higher-ID victim PATCH controls must remain unchanged after
    // *all* actions, even when the attacker forges an own employer selector.
    let foreignPatches = 0, nonadminPatches = 0, makerDecisionDenials = 0;
    let ownSubmissions = 0, ownDecisions = 0;
    for (const actor of [a, b]) {
      for (const action of ["submit", "accept", "reject"]) {
        deny(await patch(actor, victim.draftId, action, { orgId: actor.orgId }),
          403, actor.label + " foreign manager PATCH " + action);
        foreignPatches++;
      }
      deny(await patch(actor, victim.draftId, "accept",
        { checker: true, orgId: actor.orgId }),
      403, actor.label + " foreign independent-checker PATCH");
      foreignPatches++;
      deny(await patch(actor, actor.draftId, "submit", { nonadmin: true }),
        403, actor.label + " employee manager PATCH");
      nonadminPatches++;
      for (const e of employers) {
        assertNoStateChange(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " foreign PATCH did not mutate " + e.label);
      }
    }

    for (const actor of employers) {
      const beforeSubmit = await snapshot(actor.orgId);
      const submitted = await patch(actor, actor.draftId, "submit");
      const afterSubmit = await snapshot(actor.orgId);
      assertDecisionTransition(beforeSubmit, afterSubmit, actor,
        actor.draftId, "submitted", submitted);
      ownSubmissions++;
      expected.set(actor.orgId, afterSubmit);

      deny(await patch(actor, actor.draftId, "accept"), 409,
        actor.label + " maker may not approve their own submission");
      makerDecisionDenials++;
      assertNoStateChange(expected.get(actor.orgId), await snapshot(actor.orgId),
        actor.label + " self-approval denial did not mutate own planning state");

      // Both outcomes must execute: A/B accept, victim C rejects. This
      // establishes real authorized checker paths, not only denial responses.
      const action = actor === victim ? "reject" : "accept";
      const beforeDecide = await snapshot(actor.orgId);
      const decision = await patch(actor, actor.draftId, action, { checker: true });
      const afterDecide = await snapshot(actor.orgId);
      assertDecisionTransition(beforeDecide, afterDecide, actor,
        actor.draftId, action === "accept" ? "accepted" : "rejected", decision);
      ownDecisions++;
      expected.set(actor.orgId, afterDecide);
      assertOwnedPlanningRead(await get(actor), actor, afterDecide);
      for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
        assertNoStateChange(expected.get(other.orgId), await snapshot(other.orgId),
          actor.label + " legitimate PATCH must not mutate " + other.label);
      }
    }

    assert.deepEqual({
      foreignGets, foreignPosts, forgedPlanOrUnit, forgedAllocation,
      nonadminDenials, budgetDenials, ownAllocations, ownDrafts,
      foreignPatches, nonadminPatches, makerDecisionDenials,
      ownSubmissions, ownDecisions,
    }, {
      foreignGets: 2, foreignPosts: 4, forgedPlanOrUnit: 4,
      forgedAllocation: 2, nonadminDenials: 4, budgetDenials: 2,
      ownAllocations: 3, ownDrafts: 3,
      foreignPatches: 8, nonadminPatches: 2, makerDecisionDenials: 3,
      ownSubmissions: 3, ownDecisions: 3,
    });
    console.log(JSON.stringify({
      proof: "workforce-planning-allocations-and-decisions-real-pg16-http",
      gapMethod: "POST workforce-planning/allocations",
      patchMethod: "PATCH workforce-planning/allocations",
      allowedEntityTypes: ["allocation", "submission"],
      twoIndependentAttackers: true, higherIdVictim: true,
      populatedOwnGETs: 6, foreignGets, foreignPosts,
      forgedPlanOrUnit, forgedAllocation, nonadminDenials, budgetDenials,
      persistedOwnPosts: ownAllocations + ownDrafts,
      foreignPatches, nonadminPatches, makerDecisionDenials,
      ownSubmissions, ownDecisions, forgedPatchEmployerSelectors: true,
      patchVictimDbUnchanged: true, independentCheckerRoles: true,
      crossEmployerAndAuditInvariants: true, workerOrPayrollWrites: false,
      productionCertified: false, wholeMethodAccepted: false, newCredits: 0,
    }));
  } finally {
    await stopServer(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-wfp-allocations-http.mjs")) {
  proveWorkforcePlanningAllocations().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
