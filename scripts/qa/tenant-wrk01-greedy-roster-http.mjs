/**
 * WRK-01: actual GET /api/workforce/greedy-roster cross-employer read proof.
 * Only fictional employers and a disposable localhost PG16 process are used.
 * Suggestions are read-only; this runner grants ZERO new method credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ENDPOINT, requireDisposableGreedyRoster, assertOwnGreedyRoster,
  assertSuggestedGreedyRoster, assertGreedyDenied, assertGreedyNoStore,
  assertGreedySqlUnchanged, assertNoGreedyLeak,
} from "./tenant-wrk01-greedy-roster-contract.mjs";

function addDays(date, offset) {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
const plain = value => JSON.parse(JSON.stringify(value));

export async function proveGreedyRosterIsolation() {
  // Never import an application module or touch the database before this gate.
  requireDisposableGreedyRoster();
  const [database, s, drizzle, helpers, invariants, calendar] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
  ]);
  const { db, pool } = database;
  const { eq, asc, and } = drizzle;
  const request = helpers.standaloneRequest;
  const workDate = addDays(calendar.manilaWorkDate(), 7);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const tracked = [
    "organizations", "legalEntities", "orgUnits", "users", "employees",
    "employeePayProfiles", "userOrganizations", "worksites",
    "shiftDefinitions", "staffingRequirements",
    "employeeWorksiteAssignments", "hcmWorksiteAuthorizations",
    "schedulePatterns", "workforceRosterRulePolicies", "workforceScheduleGuardrailPolicies",
    "employeeScheduleAssignments", "scheduleOverrides",
    "leaveRequests", "overtimeRequests", "payrollRuns", "auditEvents",
  ];
  // The globally keyed users table is snapshotted via real company membership
  // IDs below; unlike org-scoped tables it cannot be filtered by organizationId.
  async function snapshot(e) {
    const value = {};
    for (const name of tracked.filter(name => name !== "users")) {
      const table = s[name];
      assert.ok(table?.id, "real SQL table required: " + name);
      const condition = name === "organizations"
        ? eq(table.id, e.org.id) : eq(table.organizationId, e.org.id);
      const rows = await db.select().from(table)
        .where(condition).orderBy(asc(table.id));
      value[name] = name === "auditEvents"
        ? invariants.auditBusinessSnapshot(rows) : rows;
    }
    const patternIds = value.schedulePatterns.map(row => row.id);
    value.schedulePatternDays = patternIds.length
      ? await db.select().from(s.schedulePatternDays)
        .where(drizzle.inArray(s.schedulePatternDays.patternId, patternIds))
        .orderBy(asc(s.schedulePatternDays.id)) : [];
    const dayIds = value.schedulePatternDays.map(row => row.id);
    value.schedulePatternSegments = dayIds.length
      ? await db.select().from(s.schedulePatternSegments)
        .where(drizzle.inArray(s.schedulePatternSegments.patternDayId, dayIds))
        .orderBy(asc(s.schedulePatternSegments.id)) : [];
    const userIds = value.userOrganizations.map(row => row.userId);
    value.users = userIds.length
      ? await db.select().from(s.users)
        .where(drizzle.inArray(s.users.id, userIds)).orderBy(asc(s.users.id))
      : [];
    value.payrollEntries = await db.select().from(s.payrollEntries)
      .innerJoin(s.payrollRuns, eq(s.payrollEntries.payrollRunId, s.payrollRuns.id))
      .where(eq(s.payrollRuns.organizationId, e.org.id))
      .orderBy(asc(s.payrollEntries.id));
    return plain(value);
  }
  async function freezeAll(employers) {
    return new Map(await Promise.all(employers.map(async e =>
      [e.org.id, await snapshot(e)])));
  }
  async function assertAllUnchanged(before, employers, context) {
    for (const e of employers) {
      assertGreedySqlUnchanged(before.get(e.org.id), await snapshot(e),
        context + " " + e.label);
    }
  }
  async function siteFixture(e, marker, headcount, unitId = e.unit.id) {
    const [site] = await db.insert(s.worksites).values({
      organizationId: e.org.id, orgUnitId: unitId,
      code: (marker + "-SITE").slice(0, 32),
      name: marker + " synthetic restricted worksite",
      timezone: "Asia/Manila", active: true,
    }).returning();
    const [shift] = await db.insert(s.shiftDefinitions).values({
      organizationId: e.org.id,
      code: (marker + "-SH").slice(0, 32),
      name: marker + " private synthetic shift",
      startTime: "09:00", endTime: "17:00",
      breakMinutes: 60, spansMidnight: false, active: true,
    }).returning();
    const [requirement] = await db.insert(s.staffingRequirements).values({
      organizationId: e.org.id, worksiteId: site.id,
      shiftDefinitionId: shift.id, workDate, requiredHeadcount: headcount,
      sourceType: "manual", createdBy: "Synthetic isolated QA",
      notes: marker + " private fictional demand",
    }).returning();
    // A real explicit prohibition guarantees no employee can be suggested.
    // Every unfilled result must be traced back to this stored, own-only fact.
    const [deniedSite] = await db.insert(s.employeeWorksiteAssignments).values({
      organizationId: e.org.id, employeeId: e.worker.id,
      worksiteId: site.id, decision: "deny", effectiveFrom: "2026-01-05",
      reason: marker + " site must remain restricted during read-only preview",
      createdBy: "Synthetic isolated QA",
    }).returning();
    assert.equal(deniedSite.decision, "deny");
    assert.equal(requirement.organizationId, e.org.id);
    assert.equal(requirement.worksiteId, site.id);
    assert.equal(requirement.shiftDefinitionId, shift.id);
    return { ...e, site, shift, requirement, headcount, workDate, marker };
  }
  function path(own, extra = {}) {
    const p = new URLSearchParams({
      organizationId: String(own.org.id),
      worksiteId: String(own.site.id),
      startDate: own.workDate,
      endDate: own.workDate,
      ...extra,
    });
    return ENDPOINT + "?" + p.toString();
  }

  try {
    const serverVersion = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(serverVersion.rows[0].server_version_num) / 10000),
      16, "GREEDY_ROSTER_REFUSED: actual PG16 required");
    for (const table of [s.organizations, s.staffingRequirements, s.auditEvents]) {
      assert.equal((await db.select({ id: table.id }).from(table).limit(1)).length,
        0, "GREEDY_ROSTER_REFUSED: a fresh empty disposable database is required");
    }
    const a = await helpers.seedEmployer("ATTA", nonce,
      helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce,
      helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce,
      helpers.standaloneMakeSession);
    for (const key of ["org", "entity", "unit", "owner", "worker"]) {
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "victim must have a real greater SQL ID: " + key);
    }
    assert.notEqual(a.cookie, b.cookie);
    assert.notEqual(a.cookie, victim.cookie);

    Object.assign(a, await siteFixture(a, a.marker, 2));
    Object.assign(b, await siteFixture(b, b.marker, 3));
    Object.assign(victim, await siteFixture(victim, victim.marker, 5));
    for (const key of ["site", "shift", "requirement"]) {
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "victim source ID must be greater than both attackers: " + key);
    }
    const secondUnitMarker = "PRIVATE-UNIT-B-" + nonce;
    const [secondUnit] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: a.entity.id,
      type: "department", code: secondUnitMarker,
      name: secondUnitMarker + " scoped unit",
    }).returning();
    const alphaOther = await siteFixture(a, secondUnitMarker, 6, secondUnit.id);
    assert.equal(alphaOther.site.orgUnitId, secondUnit.id);
    assert.notEqual(alphaOther.site.id, a.site.id);
    assert.notEqual(alphaOther.requirement.id, a.requirement.id);

    // Real scoped manager, not a made-up negative authorization token.
    const [manager] = await db.insert(s.users).values({
      email: ("greedy-roster-manager-" + nonce + "@example.invalid"),
      name: a.marker + " unit manager", role: "manager",
      passwordHash: "not-a-real-login", totpEnabled: true, active: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      organizationId: a.org.id, userId: manager.id,
      role: "manager", orgUnitId: a.unit.id, active: true,
    });
    const managerSession = await helpers.standaloneMakeSession(manager.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, managerSession.id));

    // Employee role must never be able to request the manager preview.
    const [employeeUser] = await db.insert(s.users).values({
      email: ("greedy-roster-employee-" + nonce + "@example.invalid"),
      name: a.marker + " synthetic employee", role: "employee",
      employeeId: a.worker.id, passwordHash: "not-a-real-login",
      active: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      organizationId: a.org.id, userId: employeeUser.id,
      role: "employee", workerEmployeeId: a.worker.id, active: true,
    });
    const employeeSession = await helpers.standaloneMakeSession(employeeUser.id);

    const subjects = [a, b, victim];
    const forbiddenFor = e => subjects.filter(x => x !== e).map(x => x.marker);
    const stable = await freezeAll(subjects);
    const read = (e, cookie = e.cookie, extra) =>
      request(path(e, extra), { cookie });
    async function ensureImmutable(label) {
      await assertAllUnchanged(stable, subjects, label);
    }
    async function denied(label, url, cookie, status, markers) {
      const before = await freezeAll(subjects);
      const result = await request(url, { cookie });
      assertGreedyDenied(result, status, markers);
      await assertAllUnchanged(before, subjects, label);
      return result;
    }

    // Three independent legitimate sessions, real employer-specific source
    // requirements and separate prohibited site assignments. No empty 200s.
    const originals = new Map();
    for (const e of subjects) {
      const own = await read(e);
      const result = assertOwnGreedyRoster(own, e, [
        ...forbiddenFor(e), secondUnitMarker,
      ].filter(marker => marker !== e.marker));
      originals.set(e.org.id, result);
      await ensureImmutable(e.label + " own populated read");
    }
    assert.notDeepEqual(originals.get(a.org.id), originals.get(b.org.id),
      "different employers must not share the same roster response");
    const ownOther = await read(alphaOther, a.cookie);
    assertOwnGreedyRoster(ownOther, alphaOther, [b.marker, victim.marker]);
    await ensureImmutable("Alpha owner read second authorized unit");

    const ownManager = await read(a, managerSession.cookie);
    assertOwnGreedyRoster(ownManager, a, [b.marker, victim.marker,
      secondUnitMarker]);
    await ensureImmutable("scoped unit manager own worksite positive");
    await denied("other unit forbidden to scoped manager",
      path(alphaOther), managerSession.cookie, 409,
      [secondUnitMarker, victim.marker, b.marker]);
    await denied("employee cannot read company roster",
      path(a), employeeSession.cookie, 403,
      [victim.marker, b.marker, secondUnitMarker]);
    await denied("anonymous future roster",
      path(a), undefined, 401, [a.marker, victim.marker]);

    for (const actor of [a, b]) {
      // The victim is feature-ON in this same localhost server; only actual
      // membership denial produces 403, not fake/feature-off 404.
      await denied(actor.label + " foreign organization",
        path(victim), actor.cookie, 403,
        [victim.marker, actor.marker]);
      await denied(actor.label + " stolen higher-ID worksite",
        path(actor, { worksiteId: String(victim.site.id) }), actor.cookie,
        409, [victim.marker, actor.marker]);
      await denied(actor.label + " another owner's worksite",
        path(actor === a ? b : a), actor.cookie, 403,
        [victim.marker, a.marker, b.marker]);

      // Extra attacker-controlled selectors are ignored, and the response
      // must stay bytewise equal to the actual own manager preview.
      const forged = await read(actor, actor.cookie, {
        employeeId: String(victim.worker.id),
        requirementId: String(victim.requirement.id),
        shiftDefinitionId: String(victim.shift.id),
        legalEntityId: String(victim.entity.id),
        payrollRunId: "99999", userId: String(victim.owner.id),
      });
      const ownAgain = assertOwnGreedyRoster(forged, actor, forbiddenFor(actor));
      assert.deepEqual(ownAgain, originals.get(actor.org.id),
        "forged victim selectors may not influence an own-scope preview");
      await ensureImmutable(actor.label + " ignored forged source selectors");
    }

    await denied("invalid query shape", path(a, {
      startDate: "2099-99-99",
    }), a.cookie, 400, [victim.marker, b.marker]);

    // Active membership revocation must beat the same existing authenticated
    // session even when that account gains another active employer.
    await db.insert(s.userOrganizations).values({
      userId: a.owner.id, organizationId: b.org.id,
      role: "owner", active: true,
    });
    await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    const afterRevocation = await freezeAll(subjects);
    await denied("same session after Alpha membership revocation",
      path(a), a.cookie, 403,
      [a.marker, victim.marker, secondUnitMarker]);
    await assertAllUnchanged(afterRevocation, subjects,
      "revoked Alpha access may not mutate other employers");
    const stillValidBeta = await request(path(b), { cookie: a.cookie });
    assertOwnGreedyRoster(stillValidBeta, b, [a.marker, victim.marker,
      secondUnitMarker]);
    await assertAllUnchanged(afterRevocation, subjects,
      "active Beta membership cannot resurrect revoked Alpha access");


    // Whole-method positive: a separate real employer has an eligible worker,
    // an authorized worksite and an approved schedule. The result must include
    // the actual SQL worker identity, not only an all-unfilled roster.
    const eligible = await helpers.seedEmployer("ELIG", nonce,
      helpers.standaloneMakeSession);
    const [eligibleSite] = await db.insert(s.worksites).values({
      organizationId: eligible.org.id, orgUnitId: eligible.unit.id,
      code: (eligible.marker + "-SITE").slice(0, 32),
      name: eligible.marker + " eligible fictional worksite",
      timezone: "Asia/Manila", active: true,
    }).returning();
    const [eligibleShift] = await db.insert(s.shiftDefinitions).values({
      organizationId: eligible.org.id,
      code: (eligible.marker + "-SH").slice(0, 32),
      name: eligible.marker + " own candidate shift",
      startTime: "12:00", endTime: "20:00",
      breakMinutes: 60, spansMidnight: false, active: true,
    }).returning();
    const [earlyShift] = await db.insert(s.shiftDefinitions).values({
      organizationId: eligible.org.id,
      code: (eligible.marker + "-EARLY").slice(0, 32),
      name: eligible.marker + " baseline early shift",
      startTime: "00:00", endTime: "01:00",
      breakMinutes: 0, spansMidnight: false, active: true,
    }).returning();
    const [eligibleRequirement] = await db.insert(s.staffingRequirements).values({
      organizationId: eligible.org.id, worksiteId: eligibleSite.id,
      shiftDefinitionId: eligibleShift.id, workDate, requiredHeadcount: 1,
      sourceType: "manual", createdBy: "Synthetic isolated QA",
      notes: eligible.marker + " unfilled real authorized staffing demand",
    }).returning();
    await db.insert(s.employeeWorksiteAssignments).values({
      organizationId: eligible.org.id, employeeId: eligible.worker.id,
      worksiteId: eligibleSite.id, decision: "allow",
      effectiveFrom: "2026-01-05",
      reason: eligible.marker + " verified own-site authorization",
      createdBy: "Synthetic isolated QA",
    });
    const [pattern] = await db.insert(s.schedulePatterns).values({
      organizationId: eligible.org.id,
      code: (eligible.marker + "-PAT").slice(0, 32),
      name: eligible.marker + " approved weekly schedule",
      cycleDays: 7, active: true,
    }).returning();
    const patternDays = await db.insert(s.schedulePatternDays).values(
      Array.from({length: 7}, (_, dayIndex) => ({
        patternId: pattern.id, dayIndex, isRestDay: dayIndex !== 0,
        label: dayIndex === 0 ? "Verified working day" : "Verified rest day",
      })),
    ).returning();
    await db.insert(s.schedulePatternSegments).values({
      patternDayId: patternDays.find(day => day.dayIndex === 0).id,
      shiftDefinitionId: earlyShift.id, segmentOrder: 1,
    });
    await db.insert(s.employeeScheduleAssignments).values({
      organizationId: eligible.org.id, employeeId: eligible.worker.id,
      patternId: pattern.id, effectiveFrom: "2026-01-05",
      anchorDate: workDate, workLocationOrgUnitId: eligible.unit.id,
      worksiteId: eligibleSite.id, reason: "Verified fictional weekly baseline",
      createdBy: "Synthetic isolated QA",
    });
    Object.assign(eligible, {
      site: eligibleSite, shift: eligibleShift,
      requirement: eligibleRequirement, headcount: 1, workDate,
    });
    const otherUnitMarker = "PRIVATE-ELIG-UNIT-" + nonce;
    const [eligibleOtherUnit] = await db.insert(s.orgUnits).values({
      organizationId: eligible.org.id, legalEntityId: eligible.entity.id,
      type: "department", code: otherUnitMarker,
      name: otherUnitMarker + " outside scope",
    }).returning();
    const [otherUnitManager] = await db.insert(s.users).values({
      email: "greedy-positive-other-unit-" + nonce + "@example.invalid",
      name: otherUnitMarker + " manager", role: "manager",
      passwordHash: "not-a-real-login", totpEnabled: true, active: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      organizationId: eligible.org.id, userId: otherUnitManager.id,
      role: "manager", orgUnitId: eligibleOtherUnit.id, active: true,
    });
    const otherUnitSession = await helpers.standaloneMakeSession(otherUnitManager.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, otherUnitSession.id));

    const allEmployers = [...subjects, eligible];
    const positiveBaseline = await freezeAll(allEmployers);
    const positiveResponse = await read(eligible);
    const positiveRoster = assertSuggestedGreedyRoster(positiveResponse, eligible,
      [a.marker, b.marker, victim.marker, secondUnitMarker, otherUnitMarker]);
    await assertAllUnchanged(positiveBaseline, allEmployers,
      "source-bound eligible recommendation");

    const forgedEligible = await read(eligible, eligible.cookie, {
      employeeId: String(victim.worker.id),
      shiftDefinitionId: String(victim.shift.id),
      requirementId: String(victim.requirement.id),
      legalEntityId: String(victim.entity.id),
      payrollRunId: "99999",
    });
    assert.deepEqual(assertSuggestedGreedyRoster(forgedEligible, eligible,
      [a.marker, b.marker, victim.marker, secondUnitMarker, otherUnitMarker]),
    positiveRoster, "forged victim selectors must not alter real eligible suggestions");
    await assertAllUnchanged(positiveBaseline, allEmployers, "forged eligible query");

    for (const actor of [b, victim]) {
      const response = await request(path(eligible), { cookie: actor.cookie });
      assertGreedyDenied(response, 403, [eligible.marker, otherUnitMarker]);
      await assertAllUnchanged(positiveBaseline, allEmployers,
        actor.label + " denied access to real eligible employee roster");
    }
    const deniedUnit = await request(path(eligible), {
      cookie: otherUnitSession.cookie,
    });
    assertGreedyDenied(deniedUnit, 409, [eligible.marker, otherUnitMarker]);
    const stolenSite = await read(eligible, eligible.cookie, {
      worksiteId: String(victim.site.id),
    });
    assertGreedyDenied(stolenSite, 409, [eligible.marker, victim.marker]);
    await assertAllUnchanged(positiveBaseline, allEmployers,
      "cross-unit and stolen-site positive-roster refusals");

    // Force a genuine PostgreSQL relation error only in this guarded disposable
    // database. Restore the table before snapshots or the next CI proof job.
    try {
      await pool.query('ALTER TABLE "staffing_requirements" RENAME TO "staffing_requirements_wfm_qa_missing"');
      const failed = await read(eligible);
      assertGreedyDenied(failed, 409, [eligible.marker, victim.marker]);
      assertGreedyNoStore(failed.headers);
      assert.equal(failed.json.error, "Verified staffing evidence could not be loaded.");
      assert.equal(failed.json.code, "WFM_GREEDY_ROSTER_SOURCE_REVIEW");
      assert.ok(!/staffing_requirements|postgres|drizzle|SELECT|node_modules|relation .* does not exist/i.test(failed.text),
        "driver exception or SQL diagnostics must not be disclosed in HTTP");
    } finally {
      await pool.query('ALTER TABLE IF EXISTS "staffing_requirements_wfm_qa_missing" RENAME TO "staffing_requirements"');
    }
    await assertAllUnchanged(positiveBaseline, allEmployers,
      "forced PostgreSQL driver exception preserved persisted tenants");
    console.log("FICTIONAL_PG16_GREEDY_ROSTER_GET_PASS: A+B populated source " +
      "plus separate nonempty eligible-worker suggestion, real higher-ID victim, " +
      "cross-unit/foreign/forged denials, revoked access, sanitized PG error, " +
      "unchanged workforce/audit/payroll; ZERO CREDITS");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith(
  "scripts/qa/tenant-wrk01-greedy-roster-http.mjs")) {
  proveGreedyRosterIsolation().catch(error => {
    console.error("FICTIONAL_PG16_GREEDY_ROSTER_GET_FAIL:", error.message);
    process.exitCode = 1;
  });
}
