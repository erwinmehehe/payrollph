/**
 * POST /api/workforce/roster-rules/preview:
 * two independent signed-in fictional attackers, genuinely higher-ID victim,
 * source-bound own 200 responses, real foreign/unknown denials and SQL immutability.
 * No credits, providers, live DB, schedule publication or payroll changes.
 *
 * Run ONLY after tenant-wrk01-greedy-roster-http.mjs in the same isolated PG16 job,
 * since that earlier runner validates a fresh empty database before seeding.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ROSTER_PREVIEW_ENDPOINT, requireDisposableWfmThreeMethods,
  assertOwnedRosterPreview, assertDeniedRosterPreview,
  assertRosterPreviewImmutable,
} from "./tenant-wfm-three-method-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
function addDays(date, offset) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export async function proveWfmRosterPreviewPost() {
  // Strict guard first; do not statically import the app, schema, DB or HTTP helpers.
  requireDisposableWfmThreeMethods();
  const [database, schema, drizzle, helpers, invariants, calendar] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
  ]);
  const { db, pool } = database;
  const { eq, and, asc, inArray } = drizzle;
  const request = helpers.standaloneRequest;
  const workDate = addDays(calendar.manilaWorkDate(), 7);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const tables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "worksites", "shiftDefinitions",
    "workforceRosterRulePolicies", "workforceScheduleGuardrailPolicies",
    "employeeScheduleAssignments", "scheduleOverrides", "timePunches",
    "leaveRequests", "overtimeRequests", "payrollRuns", "auditEvents",
  ];
  async function snapshot(e) {
    const result = {};
    for (const name of tables) {
      const table = schema[name];
      assert.ok(table?.id, "expected an actual persisted SQL table: " + name);
      const condition = name === "organizations"
        ? eq(table.id, e.org.id) : eq(table.organizationId, e.org.id);
      const rows = await db.select().from(table)
        .where(condition).orderBy(asc(table.id));
      result[name] = name === "auditEvents"
        ? invariants.auditBusinessSnapshot(rows) : rows;
    }
    const memberIds = result.userOrganizations.map(row => row.userId);
    result.users = memberIds.length
      ? await db.select().from(schema.users)
        .where(inArray(schema.users.id, memberIds)).orderBy(asc(schema.users.id))
      : [];
    result.payrollEntries = await db.select().from(schema.payrollEntries)
      .innerJoin(schema.payrollRuns,
        eq(schema.payrollEntries.payrollRunId, schema.payrollRuns.id))
      .where(eq(schema.payrollRuns.organizationId, e.org.id))
      .orderBy(asc(schema.payrollEntries.id));
    return plain(result);
  }
  let subjects = [];
  async function freeze() {
    return new Map(await Promise.all(subjects.map(async e =>
      [e.org.id, await snapshot(e)])));
  }
  async function assertUnchanged(before, label) {
    for (const e of subjects) {
      assertRosterPreviewImmutable(before.get(e.org.id), await snapshot(e),
        label + " employer " + e.org.id);
    }
  }
  function bodyFor(e, patch = {}) {
    return {
      organizationId: e.org.id,
      employeeId: e.worker.id,
      kind: "rest_day",
      workDate,
      ...patch,
    };
  }
  function forbiddenFor(e) {
    return subjects.filter(x => x !== e).map(x => x.marker);
  }
  async function post(body, cookie) {
    return request(ROSTER_PREVIEW_ENDPOINT, { method: "POST", body, cookie });
  }
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000),
      16, "real disposable PostgreSQL 16 required");
    const existing = await db.select({id: schema.organizations.id})
      .from(schema.organizations).limit(1);
    assert.equal(existing.length, 1,
      "POST proof must follow the separate successful fresh-db greedy GET runner");
    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    subjects = [a, b, victim];
    for (const key of ["org", "entity", "unit", "owner", "worker"]) {
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "real higher-ID victim required for " + key);
    }
    assert.notEqual(a.cookie, b.cookie);
    assert.notEqual(a.cookie, victim.cookie);
    for (const employer of subjects) {
      const [site] = await db.insert(schema.worksites).values({
        organizationId: employer.org.id, orgUnitId: employer.unit.id,
        code: ("BATCH-" + employer.marker).slice(0, 32),
        name: employer.marker + " private worksite",
        timezone: "Asia/Manila", active: true,
      }).returning();
      const [shift] = await db.insert(schema.shiftDefinitions).values({
        organizationId: employer.org.id,
        code: ("BATCH-" + employer.marker).slice(0, 32),
        name: employer.marker + " private 8-hour shift",
        startTime: "09:00", endTime: "17:00",
        breakMinutes: 60, spansMidnight: false, active: true,
      }).returning();
      const maxDailyMinutes = 600 + 20 * employer.rank;
      const enforcementMode = employer.rank === 2 ? "advisory" : "block";
      const [policy] = await db.insert(schema.workforceRosterRulePolicies).values({
        organizationId: employer.org.id,
        maxDailyMinutes, enforcementMode,
        updatedByUserId: employer.owner.id,
      }).returning();
      assert.equal(policy.organizationId, employer.org.id);
      Object.assign(employer, { site, shift, policy, maxDailyMinutes, enforcementMode });
    }
    for (const key of ["site", "shift", "policy"]) {
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "real higher-ID " + key + " must exist");
    }
    const [employeeUser] = await db.insert(schema.users).values({
      email: "preview-role-" + nonce + "@example.invalid",
      name: a.marker + " unprivileged fictional employee",
      passwordHash: "synthetic-only", role: "employee",
      employeeId: a.worker.id, active: true,
    }).returning();
    await db.insert(schema.userOrganizations).values({
      organizationId: a.org.id, userId: employeeUser.id,
      role: "employee", workerEmployeeId: a.worker.id, active: true,
    });
    const employeeSession = await helpers.standaloneMakeSession(employeeUser.id);
    const baseline = await freeze();

    // Three genuinely owned positive responses, including the actual victim's
    // own authenticated session, and BOTH rest_day and shift execution paths.
    for (const employer of subjects) {
      for (const patch of [
        {},
        { kind: "shift", shiftDefinitionId: employer.shift.id },
      ]) {
        const own = await post(bodyFor(employer, patch), employer.cookie);
        assertOwnedRosterPreview(own, employer, forbiddenFor(employer));
        await assertUnchanged(baseline, "owned read-only " + patch.kind);
      }
    }

    // Each independent attacker targets the actual higher-ID victim. Avoid
    // fake numerics as the sole foreign-ID case; compare nonexistent denials too.
    for (const attacker of [a, b]) {
      const targets = [
        ["foreign employer", bodyFor(victim), 403],
        ["stolen employee", bodyFor(attacker, { employeeId: victim.worker.id }), 403],
        ["stolen worksite", bodyFor(attacker, { worksiteId: victim.site.id }), 403],
        ["stolen shift", bodyFor(attacker, {
          kind: "shift", shiftDefinitionId: victim.shift.id,
        }), 404],
      ];
      const forbidden = forbiddenFor(attacker);
      for (const [label, body, status] of targets) {
        const response = await post(body, attacker.cookie);
        assertDeniedRosterPreview(response, status, forbidden);
        await assertUnchanged(baseline, label);
      }
      const missingEmployee = await post(
        bodyFor(attacker, { employeeId: victim.worker.id + 100000 }),
        attacker.cookie);
      const foreignEmployee = await post(
        bodyFor(attacker, { employeeId: victim.worker.id }),
        attacker.cookie);
      assertDeniedRosterPreview(missingEmployee, 403, forbidden);
      assert.equal(missingEmployee.text, foreignEmployee.text,
        "missing and foreign employee must have indistinguishable error bodies");
      const missingSite = await post(
        bodyFor(attacker, { worksiteId: victim.site.id + 100000 }),
        attacker.cookie);
      const foreignSite = await post(
        bodyFor(attacker, { worksiteId: victim.site.id }),
        attacker.cookie);
      assertDeniedRosterPreview(missingSite, 403, forbidden);
      assert.equal(missingSite.text, foreignSite.text,
        "missing and foreign worksite must have indistinguishable error bodies");
      const missingShift = await post(bodyFor(attacker, {
        kind: "shift", shiftDefinitionId: victim.shift.id + 100000,
      }), attacker.cookie);
      const foreignShift = await post(bodyFor(attacker, {
        kind: "shift", shiftDefinitionId: victim.shift.id,
      }), attacker.cookie);
      assertDeniedRosterPreview(missingShift, 404, forbidden);
      assert.equal(missingShift.text, foreignShift.text,
        "missing and foreign shift must have indistinguishable error bodies");
      await assertUnchanged(baseline, "nonexistent versus real foreign comparisons");
    }

    assertDeniedRosterPreview(await post(bodyFor(a), undefined), 401,
      subjects.map(e => e.marker));
    assertDeniedRosterPreview(await post(bodyFor(a), employeeSession.cookie), 403,
      forbiddenFor(a));
    await assertUnchanged(baseline, "anonymous/employee role");
    await db.update(schema.userOrganizations).set({ active: false })
      .where(and(eq(schema.userOrganizations.organizationId, b.org.id),
        eq(schema.userOrganizations.userId, b.owner.id)));
    const revokedBaseline = await freeze();
    assertDeniedRosterPreview(await post(bodyFor(b), b.cookie), 403,
      forbiddenFor(b));
    await assertUnchanged(revokedBaseline, "revoked membership");
    console.log(JSON.stringify({
      result: "PASS_CANDIDATE", method: "POST workforce/roster-rules/preview",
      attackerEmployers: 2, genuineHigherIdVictim: true,
      positiveKinds: ["rest_day", "shift"],
      foreignAndMissingEmployeeSiteShift: "indistinguishable denials",
      unauthorizedAndRevokedAccess: "denied", database: "fictional PG16",
      payrollOrRosterWrites: false, creditedMethods: 0,
      independentSecurityReview: "PENDING", productionTested: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-wfm-three-method-post-http.mjs")) {
  proveWfmRosterPreviewPost().catch(error => {
    console.error("FICTIONAL_WFM_THREE_METHOD_POST_FAILED:", error.message);
    process.exitCode = 1;
  });
}
