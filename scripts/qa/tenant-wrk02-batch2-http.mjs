/**
 * WRK-02 Batch 2, synthetic-only PostgreSQL 16 + production-mode localhost HTTP.
 * Positive outcomes: baseline POST, execution POST, execution PATCH cancel/apply.
 * Negative controls: real higher-ID victim, stolen plan, unscoped principal,
 * invalid/missing IDs, stale published baseline, duplicates and revoked grant.
 * This is proposed evidence only: ZERO new manifest method credits.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  requireDisposableWrk02Batch2, BATCH2_METHODS,
  assertDeniedPlanning, assertStoredOwnedPlanning, assertPlanningUnchanged,
} from "./tenant-wrk02-batch2-contract.mjs";

const hex = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const BASELINE = "/api/workforce-planning/baselines";
const EXECUTION = "/api/workforce-planning/position-executions";

export async function proveWrk02Batch2() {
  // Absolutely no application / database module imports before this refusal.
  requireDisposableWrk02Batch2();
  const [database, s, drizzle, helpers, invariants] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  const { and, asc, eq } = drizzle;
  const request = helpers.standaloneRequest;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  try {
    const serverVersion = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(serverVersion.rows[0]?.server_version_num) / 10000), 16,
      "WRK02_BATCH2_REFUSED: actual disposable PostgreSQL 16 required");
    const existing = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
    assert.equal(existing.length, 0, "Fixture refuses preexisting employer data");

    // Different authenticated companies, seeded in SQL ID order. The victim
    // has a genuinely higher scenario, plan, position, baseline and execution
    // ID than either attacker. No hard-coded IDs or fabricated HTTP responses.
    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    const excluded = await helpers.seedEmployer("UNLISTED", nonce, helpers.standaloneMakeSession);
    const subjects = [a, b, victim, excluded];
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(excluded.org.id > victim.org.id);
    for (const employer of subjects) {
      assert.match(employer.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
      assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations)
        .where(eq(s.organizations.id, employer.org.id))).length, 1);
    }
    async function seedPlanScenario(employer, suffix = "one") {
      const [plan] = await db.insert(s.workforcePlans).values({
        organizationId: employer.org.id,
        name: employer.marker + " " + suffix + " fictional plan",
        startDate: "2026-11-01", endDate: "2027-10-31",
        budget: "200000.00", status: "draft",
        createdByUserId: employer.owner.id, createdBy: employer.owner.name,
      }).returning();
      const [job] = await db.insert(s.jobProfiles).values({
        organizationId: employer.org.id,
        title: employer.marker + " " + suffix + " fictional position job",
        family: "General", level: "Individual Contributor", active: true,
      }).returning();
      const [position] = await db.insert(s.positions).values({
        organizationId: employer.org.id,
        code: (employer.marker + "-" + suffix + "-POS").slice(0, 48),
        jobProfileId: job.id, orgUnitId: employer.unit.id,
        legalEntityId: employer.entity.id, planId: plan.id,
        employmentType: "Regular", status: "planned",
        plannedStartDate: "2026-11-15", annualBudget: "120000.00",
        notes: employer.marker + " unfilled fictional planned position",
        createdByUserId: employer.owner.id,
      }).returning();
      const snapshot = {
        version: "fictional-qa-approved-scenario-only",
        marker: employer.marker,
        forecast: { summary: {} },
        boundary: "The approved state is seeded only in a disposable PG16 fixture; it does not prove the Batch 1 approval workflow.",
      };
      const [scenario] = await db.insert(s.workforcePlanningScenarios).values({
        organizationId: employer.org.id,
        planId: plan.id,
        name: employer.marker + " " + suffix + " fictional approved scenario",
        version: 1, scopeOrgUnitId: null, worksiteId: null,
        startDate: "2026-11-01", endDate: "2027-10-31",
        status: "approved", snapshot, snapshotHash: hex(snapshot),
        createdByUserId: employer.owner.id,
        decidedByUserId: employer.owner.id, decidedAt: new Date(),
        decisionNote: "Synthetic fixture only: not a live approval",
      }).returning();
      for (const row of [plan, position, scenario]) {
        assert.equal(row.organizationId, employer.org.id);
        assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
      }
      return { plan, job, position, scenario };
    }
    // Scenario and position setup is intentional fixture insertion, not a
    // claim that preceding Batch 1 route methods are independently proven.
    a.seed = await seedPlanScenario(a);
    b.seed = await seedPlanScenario(b);
    victim.seed = await seedPlanScenario(victim);
    assert.ok(victim.seed.scenario.id > Math.max(a.seed.scenario.id, b.seed.scenario.id));
    assert.ok(victim.seed.position.id > Math.max(a.seed.position.id, b.seed.position.id));
    assert.ok(victim.seed.plan.id > Math.max(a.seed.plan.id, b.seed.plan.id));

    const snapshotTables = [
      "organizations", "workforcePlans", "workforcePlanningScenarios",
      "workforcePlanBaselines", "workforcePlanPositionExecutions",
      "positions", "positionAssignments", "jobRequisitions",
      "employees", "employeePayProfiles", "auditEvents", "payrollRuns",
      "approvalChainInstances", "approvalTasks", "userOrganizations",
      "permissionSets", "userPermissionAssignments",
    ];
    async function snapshot(organizationId) {
      const entries = await Promise.all(snapshotTables.map(async name => {
        const table = s[name];
        assert.ok(table?.id, "Real PostgreSQL table missing: " + name);
        const rows = await db.select().from(table)
          .where(eq(name === "organizations" ? table.id : table.organizationId, organizationId))
          .orderBy(asc(table.id));
        return [name, name === "auditEvents"
          ? invariants.auditBusinessSnapshot(rows) : rows];
      }));
      const payrollEntries = await db.select({ row: s.payrollEntries })
        .from(s.payrollEntries).innerJoin(s.payrollRuns,
          eq(s.payrollEntries.payrollRunId, s.payrollRuns.id))
        .where(eq(s.payrollRuns.organizationId, organizationId))
        .orderBy(asc(s.payrollEntries.id));
      return plain({ ...Object.fromEntries(entries), payrollEntries });
    }
    async function freeze() {
      return new Map(await Promise.all(subjects.map(async employer =>
        [employer.org.id, await snapshot(employer.org.id)])));
    }
    async function unchangedAll(before, label) {
      for (const employer of subjects) assertPlanningUnchanged(
        before.get(employer.org.id), await snapshot(employer.org.id),
        label + " / " + employer.marker);
    }
    async function unchangedForeign(before, actor, label) {
      for (const employer of subjects.filter(x => x !== actor)) assertPlanningUnchanged(
        before.get(employer.org.id), await snapshot(employer.org.id),
        label + " did not alter other employer " + employer.marker);
    }
    const denied = async (path, opts, expected, label) => {
      const before = await freeze();
      const response = await request(path, opts);
      assertDeniedPlanning(response, expected, subjects.map(x => x.marker));
      await unchangedAll(before, label);
      return response;
    };
    const actorResponse = async (path, opts, actor, status, label) => {
      const before = await freeze();
      const response = await request(path, opts);
      assert.equal(response.status, status,
        label + ": expected " + status + " got " + response.status +
        " " + response.text.slice(0, 260));
      await unchangedForeign(before, actor, label);
      for (const foreign of subjects.filter(x => x !== actor))
        assert.ok(!response.text.includes(foreign.marker),
          label + ": authorized response exposed foreign employer marker");
      return response;
    };
    const baselineBody = employer => ({ scenarioId: employer.seed.scenario.id });
    const executionBody = employer => ({
      organizationId: employer.org.id, planId: employer.seed.plan.id,
    });

    let foreignBaseline404 = 0, foreignPreviewDenials = 0, foreignDecisionDenials = 0;
    for (const actor of [a, b]) {
      // The victim scenario is real, approved and higher-ID; so 404 must
      // result from missing active tenant membership, not a fake object.
      await denied(BASELINE, { method: "POST", body: baselineBody(victim),
        cookie: actor.cookie }, 404, "foreign approved scenario");
      foreignBaseline404++;
      await denied(BASELINE, { method: "POST", body: {
        scenarioId: 2_147_483_646,
      }, cookie: actor.cookie }, 404, "unknown scenario");
      await denied(BASELINE, { method: "POST", body: {
        scenarioId: "not-an-id",
      }, cookie: actor.cookie }, 400, "invalid scenario selector");
    }
    await denied(BASELINE, { method: "POST", body: baselineBody(a) },
      401, "anonymous baseline publish");

    // One real 201 and one real 409 must result from racing the same
    // approved scenario on Alpha; plan locking and scenario uniqueness
    // must not publish two versions, even under concurrent requests.
    const beforeRace = await freeze();
    const racing = await Promise.all([
      request(BASELINE, { method: "POST", cookie: a.cookie,
        body: { ...baselineBody(a), organizationId: victim.org.id } }),
      request(BASELINE, { method: "POST", cookie: a.cookie,
        body: { ...baselineBody(a), organizationId: victim.org.id } }),
    ]);
    assert.deepEqual(racing.map(x => x.status).sort((x, y) => x - y), [201, 409],
      "Same-scenario baseline race must commit once and reject the second writer");
    await unchangedForeign(beforeRace, a, "concurrent legitimate Alpha baseline");
    const a201 = racing.find(x => x.status === 201);
    assert.ok(a201);
    const b201 = await actorResponse(BASELINE, { method: "POST",
      cookie: b.cookie, body: baselineBody(b) }, b, 201, "Beta owned baseline");
    const v201 = await actorResponse(BASELINE, { method: "POST",
      cookie: victim.cookie, body: baselineBody(victim) },
      victim, 201, "Victim positive owned baseline");

    async function verifyBaseline(employer, response, expectedVersion = 1) {
      const [row] = await db.select().from(s.workforcePlanBaselines)
        .where(eq(s.workforcePlanBaselines.id, response.json?.baseline?.id)).limit(1);
      assertStoredOwnedPlanning(response, row, {
        method: "baseline", organizationId: employer.org.id,
        forbiddenMarkers: subjects.filter(x => x !== employer).map(x => x.marker),
      });
      assert.equal(row.planId, employer.seed.plan.id);
      assert.equal(row.scenarioId, employer.seed.scenario.id);
      assert.equal(row.version, expectedVersion);
      assert.equal(row.current, true);
      assert.equal(row.scopeOrgUnitId, null);
      assert.equal(row.worksiteId, null);
      assert.equal(row.snapshotHash, hex(row.snapshot),
        "Persisted baseline evidence must be SHA-bound to its actual SQL snapshot");
      assert.deepEqual(row.snapshot?.headcount?.positionIds, [employer.seed.position.id]);
      assert.equal(row.snapshot?.positionExecutionSource?.version,
        "hcm-position-execution-source-v1");
      assert.equal(row.snapshot.positionExecutionSource.positionCount, 1);
      assert.equal(row.snapshot.positionExecutionSource.positions[0].sourcePositionId,
        employer.seed.position.id);
      const [plan] = await db.select().from(s.workforcePlans)
        .where(eq(s.workforcePlans.id, employer.seed.plan.id)).limit(1);
      assert.equal(plan.status, "published");
      return row;
    }
    a.baseline = await verifyBaseline(a, a201);
    b.baseline = await verifyBaseline(b, b201);
    victim.baseline = await verifyBaseline(victim, v201);
    assert.ok(victim.baseline.id > Math.max(a.baseline.id, b.baseline.id));
    const [alphaCount] = await db.select({ id: s.workforcePlanBaselines.id })
      .from(s.workforcePlanBaselines).where(and(
        eq(s.workforcePlanBaselines.organizationId, a.org.id),
        eq(s.workforcePlanBaselines.scenarioId, a.seed.scenario.id),
      )).limit(2);
    assert.ok(alphaCount?.id, "Concurrent publication must persist exactly the own baseline row");
    const alphaAll = await db.select().from(s.workforcePlanBaselines)
      .where(eq(s.workforcePlanBaselines.organizationId, a.org.id));
    assert.equal(alphaAll.length, 1, "Baseline double-publish race cannot create a second SQL version");

    for (const actor of [a, b]) {
      await denied(EXECUTION, { method: "POST", cookie: actor.cookie,
        body: { organizationId: victim.org.id, planId: victim.seed.plan.id } },
      403, "direct victim employer execution preview");
      await denied(EXECUTION, { method: "POST", cookie: actor.cookie,
        body: { organizationId: actor.org.id, planId: victim.seed.plan.id } },
      404, "victim plan ID forged inside own organization");
      foreignPreviewDenials += 2;
    }
    await denied(EXECUTION, { method: "POST",
      body: executionBody(a) }, 401, "anonymous execution preview");

    for (const actor of [a, b, victim]) {
      const response = await actorResponse(EXECUTION, { method: "POST",
        cookie: actor.cookie, body: executionBody(actor) },
        actor, 201, "Owned persisted position execution preview");
      const [row] = await db.select().from(s.workforcePlanPositionExecutions)
        .where(eq(s.workforcePlanPositionExecutions.id, response.json?.execution?.id))
        .limit(1);
      assertStoredOwnedPlanning(response, row, {
        method: "execution", organizationId: actor.org.id,
        forbiddenMarkers: subjects.filter(x => x !== actor).map(x => x.marker),
      });
      assert.equal(row.planId, actor.seed.plan.id);
      assert.equal(row.baselineId, actor.baseline.id);
      assert.equal(row.status, "preview");
      assert.equal(row.executionPlan?.preview?.summary?.blockerCount, 0);
      assert.equal(row.executionPlan?.preview?.summary?.updateCount, 1);
      assert.equal(row.executionPlan?.preview?.summary?.createCount, 0);
      assert.equal(row.executionPlan?.preview?.actions?.[0]?.after?.status, "approved");
      const { generatedAt, boundary, ...evidence } = row.executionPlan;
      assert.ok(generatedAt && boundary);
      assert.equal(row.executionHash, hex(evidence),
        "SQL execution hash must match stored immutable preview evidence");
      const [unchangedPosition] = await db.select().from(s.positions)
        .where(eq(s.positions.id, actor.seed.position.id)).limit(1);
      assert.equal(unchangedPosition.status, "planned",
        "Preview must NEVER advance the live position");
      actor.execution = row;
    }
    assert.ok(victim.execution.id > Math.max(a.execution.id, b.execution.id));
    const victimBefore = await snapshot(victim.org.id);

    // Duplicate same-current-state preview is a real authenticated success
    // and must return the exact saved row without an extra audit or mutation.
    for (const actor of [a, b]) {
      const before = await freeze();
      const reused = await request(EXECUTION, { method: "POST",
        cookie: actor.cookie, body: executionBody(actor) });
      assert.equal(reused.status, 200);
      assert.equal(reused.json?.reused, true);
      assert.equal(reused.json?.execution?.id, actor.execution.id);
      await unchangedAll(before, "idempotent position preview");
    }

    // A People-admin role at an assigned unit is not a company-wide plan
    // publisher or executor. This is a real authenticated unit-scoped HR
    // membership, not a fake 403 returned by a role-only mock.
    const [scopedHr] = await db.insert(s.users).values({
      email: "wrk02-scoped-hr-" + nonce + "@example.invalid",
      name: "Fictional unit-scoped HR", role: "owner",
      passwordHash: "fictional-session-only", totpEnabled: true,
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: scopedHr.id, organizationId: a.org.id,
      role: "hr", orgUnitId: a.unit.id, active: true,
    });
    const scopedSession = await helpers.standaloneMakeSession(scopedHr.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, scopedSession.id));
    assert.equal((await request("/api/account", {
      cookie: scopedSession.cookie,
    })).status, 200, "Unit-scoped People HR must be a real active session");
    for (const [path, method, body] of [
      [BASELINE, "POST", baselineBody(a)],
      [EXECUTION, "POST", executionBody(a)],
      [EXECUTION, "PATCH", { executionId: a.execution.id, action: "cancel" }],
    ]) {
      await denied(path, { method, body, cookie: scopedSession.cookie },
        403, "unit-scoped People HR is not company-wide");
    }

    // Both PATCH actions must reject a real *higher-ID* victim execution,
    // not just an invalid or non-existent ID. The victim stays intact.
    for (const actor of [a, b]) {
      for (const action of ["cancel", "apply"]) {
        await denied(EXECUTION, { method: "PATCH",
          cookie: actor.cookie,
          body: { executionId: victim.execution.id, action } },
        403, "cross-employer " + action + " on real victim execution");
        foreignDecisionDenials++;
      }
      await denied(EXECUTION, { method: "PATCH",
        cookie: actor.cookie,
        body: { executionId: 2_147_483_646, action: "apply" } },
      404, "missing execution must never act on a victim");
      await denied(EXECUTION, { method: "PATCH",
        cookie: actor.cookie,
        body: { executionId: actor.execution.id, action: "override" } },
      400, "unsupported execution mutation");
    }
    await denied(EXECUTION, { method: "PATCH",
      body: { executionId: a.execution.id, action: "cancel" } },
    401, "anonymous execution mutation");

    // Both actors cancel legitimate preview rows. A forged organizationId
    // on the PATCH body is ignored; the target is resolved from the stored
    // exact execution owner and all foreign employers remain unchanged.
    for (const actor of [a, b]) {
      const resp = await actorResponse(EXECUTION, { method: "PATCH",
        cookie: actor.cookie,
        body: { executionId: actor.execution.id, action: "cancel",
          organizationId: victim.org.id, baselineId: victim.baseline.id } },
      actor, 200, "owned execution cancel");
      assert.equal(resp.json?.execution?.id, actor.execution.id);
      assert.equal(resp.json?.execution?.organizationId, actor.org.id);
      assert.equal(resp.json?.execution?.status, "cancelled");
      const [position] = await db.select().from(s.positions)
        .where(eq(s.positions.id, actor.seed.position.id)).limit(1);
      assert.equal(position.status, "planned", "Cancellation never edits live positions");
      await denied(EXECUTION, { method: "PATCH", cookie: actor.cookie,
        body: { executionId: actor.execution.id, action: "cancel" } },
      409, "cancelled preview cannot be decided twice");

      const reopened = await actorResponse(EXECUTION, { method: "POST",
        cookie: actor.cookie, body: executionBody(actor) }, actor, 200,
      "cancelled exact-hash preview can reopen in owner employer");
      assert.equal(reopened.json?.reused, true);
      assert.equal(reopened.json?.reopened, true);
      assert.equal(reopened.json?.execution?.id, actor.execution.id);
      assert.equal(reopened.json?.execution?.status, "preview");
    }

    // Alpha executes its own planned position to approved. A replay is
    // denied. No employee, assignment, requisition or payroll write occurs.
    const aApply = await actorResponse(EXECUTION, {
      method: "PATCH", cookie: a.cookie,
      body: { executionId: a.execution.id, action: "apply" },
    }, a, 200, "Alpha own exact-hash apply");
    assert.equal(aApply.json?.execution?.id, a.execution.id);
    assert.equal(aApply.json?.execution?.status, "applied");
    assert.equal(aApply.json?.execution?.result?.updatedPositions?.length, 1);
    assert.equal(aApply.json?.execution?.result?.createdPositions?.length, 0);
    const [alphaPosition] = await db.select().from(s.positions)
      .where(eq(s.positions.id, a.seed.position.id)).limit(1);
    assert.equal(alphaPosition.organizationId, a.org.id);
    assert.equal(alphaPosition.status, "approved",
      "Legitimate own PATCH apply must really update one persisted SQL position");
    await denied(EXECUTION, { method: "PATCH", cookie: a.cookie,
      body: { executionId: a.execution.id, action: "apply" } },
    409, "already-applied execution cannot run a second time");

    // Beta has an already-previewed baseline v1. Publish a different,
    // independently approved (fictional) scenario to create v2. The
    // original execution must be rejected as STALE with no position change.
    const revisionSnapshot = {
      version: "fictional-qa-approved-revision-only", marker: b.marker,
      boundary: "Synthetic Batch 2 approved revision only, not a Batch 1 workflow proof.",
    };
    const [revisionScenario] = await db.insert(s.workforcePlanningScenarios).values({
      organizationId: b.org.id, planId: b.seed.plan.id,
      name: b.marker + " synthetic approved revision v2", version: 1,
      scopeOrgUnitId: null, worksiteId: null,
      startDate: "2026-11-01", endDate: "2027-10-31",
      status: "approved", snapshot: revisionSnapshot,
      snapshotHash: hex(revisionSnapshot),
      createdByUserId: b.owner.id, decidedByUserId: b.owner.id,
      decidedAt: new Date(), decisionNote: "Synthetic approved revision, not a live decision",
    }).returning();
    assert.equal(revisionScenario.organizationId, b.org.id);
    const secondBaselineResp = await actorResponse(BASELINE, {
      method: "POST", cookie: b.cookie, body: { scenarioId: revisionScenario.id },
    }, b, 201, "Beta owned baseline replacement v2");
    const [secondBaseline] = await db.select().from(s.workforcePlanBaselines)
      .where(eq(s.workforcePlanBaselines.id, secondBaselineResp.json?.baseline?.id)).limit(1);
    assertStoredOwnedPlanning(secondBaselineResp, secondBaseline, {
      method: "baseline", organizationId: b.org.id,
      forbiddenMarkers: [a.marker, victim.marker, excluded.marker],
    });
    assert.equal(secondBaseline.version, 2);
    assert.equal(secondBaseline.current, true);
    const [superseded] = await db.select().from(s.workforcePlanBaselines)
      .where(eq(s.workforcePlanBaselines.id, b.baseline.id)).limit(1);
    assert.equal(superseded.current, false);
    const beforeStale = await freeze();
    const stale = await request(EXECUTION, {
      method: "PATCH", cookie: b.cookie,
      body: { executionId: b.execution.id, action: "apply" },
    });
    assertDeniedPlanning(stale, 409, [a.marker, victim.marker, excluded.marker]);
    assert.match(stale.json?.error ?? "", /baseline changed/i);
    await unchangedAll(beforeStale,
      "stale baseline v1 preview must fail before any position, payroll or audit write");
    const [stillPlanned] = await db.select().from(s.positions)
      .where(eq(s.positions.id, b.seed.position.id)).limit(1);
    assert.equal(stillPlanned.status, "planned");

    const betaFresh = await actorResponse(EXECUTION, {
      method: "POST", cookie: b.cookie, body: executionBody(b),
    }, b, 201, "Beta fresh baseline v2 preview");
    assert.equal(betaFresh.json?.execution?.baselineId, secondBaseline.id);
    assert.notEqual(betaFresh.json?.execution?.id, b.execution.id);
    const betaApply = await actorResponse(EXECUTION, {
      method: "PATCH", cookie: b.cookie,
      body: { executionId: betaFresh.json.execution.id, action: "apply" },
    }, b, 200, "Beta own baseline v2 apply");
    assert.equal(betaApply.json?.execution?.status, "applied");
    assert.equal(betaApply.json?.execution?.result?.updatedPositions?.length, 1);
    const [betaPosition] = await db.select().from(s.positions)
      .where(eq(s.positions.id, b.seed.position.id)).limit(1);
    assert.equal(betaPosition.status, "approved");

    // A revoked employer grant must deny with the SAME still-valid account
    // cookie. Neither cached plan IDs nor previous proof grants a bypass.
    const revoke = await db.update(s.userOrganizations).set({ active: false })
      .where(and(
        eq(s.userOrganizations.userId, b.owner.id),
        eq(s.userOrganizations.organizationId, b.org.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(revoke.length, 1);
    const beforeRevokeReads = await freeze();
    const sessionControl = await request("/api/account", { cookie: b.cookie });
    assert.equal(sessionControl.status, 200, "Account session stays valid after employer grant revocation");
    for (const [path, method, body, status] of [
      [BASELINE, "POST", { scenarioId: revisionScenario.id }, 404],
      [EXECUTION, "POST", executionBody(b), 403],
      [EXECUTION, "PATCH", { executionId: b.execution.id, action: "cancel" }, 403],
    ]) {
      const resp = await request(path, { method, body, cookie: b.cookie });
      assertDeniedPlanning(resp, status, [a.marker, victim.marker, excluded.marker]);
    }
    await unchangedAll(beforeRevokeReads, "real revoked employer membership");

    // A valid, MFA-verified owner may still have a deny-only custom
    // permission set. It must be enforced for ALL three writes before
    // inspecting already-published or already-applied business-state data.
    const [ownerMembership] = await db.select({ id: s.userOrganizations.id })
      .from(s.userOrganizations).where(and(
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true),
      )).limit(1);
    assert.ok(ownerMembership?.id, "Fictional owner membership must exist");
    const [denyPeople] = await db.insert(s.permissionSets).values({
      organizationId: a.org.id,
      name: "Fictional deny people admin",
      permissions: ["workforce.manage"], active: true,
      createdByUserId: a.owner.id,
    }).returning({ id: s.permissionSets.id });
    await db.insert(s.userPermissionAssignments).values({
      organizationId: a.org.id,
      userOrganizationId: ownerMembership.id,
      permissionSetId: denyPeople.id, assignedByUserId: a.owner.id,
    });
    assert.equal((await request("/api/account", { cookie: a.cookie })).status, 200,
      "Custom permission restriction cannot be confused with sign-out");
    for (const [path, method, body] of [
      [BASELINE, "POST", baselineBody(a)],
      [EXECUTION, "POST", executionBody(a)],
      [EXECUTION, "PATCH", { executionId: a.execution.id, action: "apply" }],
    ]) {
      const deniedOverlay = await denied(path, {
        method, body, cookie: a.cookie,
      }, 403, "active owner denied by people.admin permission overlay");
      assert.match(deniedOverlay.json?.error ?? "", /custom permission set/i,
        "Actual People-admin permission overlay must deny, not an unrelated 403");
    }

    assertPlanningUnchanged(victimBefore, await snapshot(victim.org.id),
      "All foreign actions must leave genuine higher-ID victim employer entirely immutable");
    const allAudit = await db.select().from(s.auditEvents)
      .where(eq(s.auditEvents.organizationId, a.org.id));
    assert.ok(allAudit.some(x => x.action === "Workforce plan baseline published"));
    assert.ok(allAudit.some(x => x.action === "Workforce plan position execution preview created"));
    assert.ok(allAudit.some(x => x.action === "Workforce plan position execution cancelled"));
    assert.ok(allAudit.some(x => x.action === "Workforce plan position execution preview reopened"));
    assert.ok(allAudit.some(x => x.action === "Published workforce plan executed to positions"));

    const receipt = {
      kind: "tenant-wrk02-batch2-fictional-pg16-real-http",
      methods: BATCH2_METHODS,
      twoIndependentActors: true,
      higherIdVictimScenarioBaselinePlanExecution: true,
      legitimateOwnBaseline201: 3,
      sameScenarioRace: { committed: 1, denied: 1 },
      foreignScenario404: foreignBaseline404,
      foreignPositionPreviewDenials: foreignPreviewDenials,
      foreignPositionMutationDenials: foreignDecisionDenials,
      realOwnPositionPreviewCreated: 3,
      ownCancelReopenApply: true,
      stalePublishedBaselineApply409: true,
      currentBaselineVersionTwoApply200: true,
      stillSignedInAfterMembershipRevocation: true,
      unitScopedPeopleHrWritesDenied: 3,
      activeOwnerWithoutPeoplePermissionDenied: 3,
      victimPayrollAndAuditUnchanged: true,
      externalProviderCalls: false,
      batch1ApprovalProven: false,
      manifestMethodCredits: 0,
      independentReviewAccepted: false,
      productionCertified: false,
    };
    console.log("WRK02_BATCH2_HTTP_COMPLETE " + JSON.stringify(receipt));
    return receipt;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-wrk02-batch2-http.mjs")) {
  proveWrk02Batch2().catch(error => {
    console.error("WRK02_BATCH2_HTTP_FAILED: " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
