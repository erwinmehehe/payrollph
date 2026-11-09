/**
 * Real production-mode localhost HTTP and disposable PostgreSQL 16 verification
 * of HCM Team Leave Calendar SSR and GET. Two separately signed-in owners,
 * an actual higher-ID victim, one unit-scoped manager, and refusal controls.
 * Source-only evidence: zero API/page credits, no production activation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE_PATH, API_PATH, requireDisposableTeamLeaveEnv,
  verifyTeamLeaveSourcePins, assertNoTenantMarkers, assertDeniedResponse,
  assertOwnPage, assertOwnLeaveResponse, assertReadOnlySql,
} from "./tenant-team-leave-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
function philippineMonth() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const field = type => parts.find(x => x.type === type)?.value ?? "";
  return field("year") + "-" + field("month");
}
async function get(path, cookie) {
  const response = await fetch(ORIGIN + path, {
    headers: cookie ? { cookie } : {}, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSR or denial response */ }
  return { status: response.status, text, json, headers: response.headers };
}
const pagePath = organizationId => PAGE_PATH + "?organizationId=" + organizationId;
const apiPath = (organizationId, month) => API_PATH + "?organizationId=" + organizationId + "&month=" + month;

export async function proveTeamLeaveIsolation() {
  // Fail before touching any application code, session fixture or database.
  requireDisposableTeamLeaveEnv();
  verifyTeamLeaveSourcePins();
  const [{ db, pool }, schema, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { asc, eq, and } = orm;
  const month = philippineMonth();
  const tables = ["organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "leaveRequests", "auditEvents"];
  async function snapshot(orgId) {
    const out = {};
    for (const name of tables) {
      const table = schema[name];
      assert.ok(table?.id && table?.organizationId || name === "organizations" && table?.id,
        "Unknown employer-owned SQL source: " + name);
      out[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
        .orderBy(asc(table.id)));
    }
    return out;
  }
  let ownPages = 0, ownApi = 0, foreignDenials = 0, negativeChecks = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "TEAM_LEAVE_REFUSED: requires actual PG16");
    assert.equal((await db.select().from(schema.organizations).limit(1)).length, 0,
      "TEAM_LEAVE_REFUSED: app_db must have no previous employers");
    assert.equal((await db.select().from(schema.users).limit(1)).length, 0,
      "TEAM_LEAVE_REFUSED: no previously seeded or real users allowed");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = { ...(await fixtures.seedEmployer(label, nonce, fixtures.standaloneMakeSession)), label };
      actor.privateReason = actor.marker + "-CONFIDENTIAL-REASON";
      actor.privateType = "SecretLeave-" + label;
      const [otherUnit] = await db.insert(schema.orgUnits).values({
        organizationId: actor.org.id, legalEntityId: actor.entity.id,
        type: "department", code: actor.marker.slice(0, 26) + "-2",
        name: actor.marker + " other-unit",
      }).returning();
      const [otherWorker] = await db.insert(schema.employees).values({
        organizationId: actor.org.id, legalEntityId: actor.entity.id,
        orgUnitId: otherUnit.id, employeeNo: actor.marker + "-2",
        firstName: "Other", lastName: actor.marker + "-unit",
        title: "Fictional worker", avatarInitials: "FL", basicRate: "20000.00",
        startDate: "2026-01-05",
      }).returning();
      const leaveInput = (employeeId, status, suffix) => ({
        organizationId: actor.org.id, employeeId, leaveType: actor.privateType,
        startDate: month + (suffix === "home" ? "-10" : "-11"),
        endDate: month + (suffix === "home" ? "-10" : "-11"),
        days: "1.0", reason: actor.privateReason, status,
      });
      const [homeLeave] = await db.insert(schema.leaveRequests).values(
        leaveInput(actor.worker.id, "Pending", "home")).returning();
      const [unitLeave] = await db.insert(schema.leaveRequests).values(
        leaveInput(otherWorker.id, "Approved", "other")).returning();
      const [cancelled] = await db.insert(schema.leaveRequests).values(
        leaveInput(actor.worker.id, "Cancelled", "home")).returning();
      actor.otherUnit = otherUnit;
      actor.otherWorker = otherWorker;
      actor.leaves = [homeLeave, unitLeave];
      actor.cancelled = cancelled;
      actors.push(actor);
    }
    const [a, b, victim] = actors;
    assert.deepEqual(actors.map(x => x.org.id), [1, 2, 3],
      "TEAM_LEAVE_REFUSED: allowlist must cover exactly three fresh fictional employers");
    for (const key of ["org", "worker", "otherWorker"])
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "The genuine persisted victim " + key + " ID must be greater than both attackers");
    assert.ok(victim.leaves.every(v => v.id > Math.max(...a.leaves.map(x => x.id), ...b.leaves.map(x => x.id))),
      "Victim's real leave IDs must be higher than both actors' leave IDs");

    async function makeRole(role, orgUnitId) {
      const [user] = await db.insert(schema.users).values({
        email: "team-leave-" + role + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " leave reader", passwordHash: "fixture-no-login",
        role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(schema.userOrganizations).values({
        organizationId: a.org.id, userId: user.id, role, orgUnitId, active: true,
      });
      const session = await fixtures.standaloneMakeSession(user.id);
      await db.update(schema.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(schema.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const unitManager = await makeRole("manager", a.unit.id);
    const bookkeeper = await makeRole("bookkeeper", null);
    const baseline = new Map();
    for (const actor of actors) baseline.set(actor.org.id, await snapshot(actor.org.id));
    const checkUnchanged = async label => {
      for (const actor of actors)
        assertReadOnlySql(baseline.get(actor.org.id), await snapshot(actor.org.id),
          label + ": " + actor.label);
    };
    const deny = async (path, cookie, expected, label) => {
      const response = await get(path, cookie);
      assertDeniedResponse(response, expected, actors, label);
      await checkUnchanged(label);
      negativeChecks++;
      return response;
    };

    for (const actor of [a, b]) {
      const others = actors.filter(x => x !== actor);
      const ownPage = await get(pagePath(actor.org.id), actor.cookie);
      assertOwnPage(ownPage, actor, others);
      await checkUnchanged("authorized SSR of " + actor.label);
      ownPages++;
      const owned = await get(apiPath(actor.org.id, month), actor.cookie);
      assertOwnLeaveResponse(owned, actor, others, actor.leaves,
        { kind: "company", orgUnitId: null }, month);
      await checkUnchanged("authorized GET for " + actor.label);
      ownApi++;

      await deny(pagePath(victim.org.id), actor.cookie, 404,
        actor.label + " foreign page must not mount");
      await deny(apiPath(victim.org.id, month), actor.cookie, 403,
        actor.label + " foreign real leave source");
      foreignDenials += 2;
      await deny(pagePath("01"), actor.cookie, 404,
        actor.label + " noncanonical page employer selector");
      await deny(apiPath("01", month), actor.cookie, 400,
        actor.label + " noncanonical API employer selector");
      await deny(pagePath(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 404, actor.label + " duplicate employer page selector");
      await deny(apiPath(actor.org.id, "1999-01"), actor.cookie, 400,
        actor.label + " out-of-window month");
    }

    const managerPage = await get(pagePath(a.org.id), unitManager.cookie);
    assertOwnPage(managerPage, a, [b, victim]);
    await checkUnchanged("unit manager SSR");
    ownPages++;
    const managerRead = await get(apiPath(a.org.id, month), unitManager.cookie);
    assertOwnLeaveResponse(managerRead, a, [b, victim], [a.leaves[0]],
      { kind: "unit", orgUnitId: a.unit.id }, month);
    assert.ok(!managerRead.text.includes(a.otherWorker.employeeNo),
      "Scoped manager cannot see a worker in another unit of the same employer");
    await checkUnchanged("unit manager scoped GET");
    ownApi++;
    await deny(pagePath(victim.org.id), unitManager.cookie, 404,
      "unit manager denied foreign employer page");
    await deny(apiPath(victim.org.id, month), unitManager.cookie, 403,
      "unit manager denied foreign employer records");
    foreignDenials += 2;
    await deny(pagePath(a.org.id), bookkeeper.cookie, 404,
      "bookkeeper cannot render HR leave page");
    await deny(apiPath(a.org.id, month), bookkeeper.cookie, 403,
      "bookkeeper without manager unit cannot read HR leave requests");
    const anonymousPage = await get(pagePath(a.org.id));
    assert.ok([307, 308].includes(anonymousPage.status),
      "Anonymous SSR should redirect to login, not render the tenant page");
    assert.ok(anonymousPage.headers.get("location")?.includes("/login"));
    assertNoTenantMarkers(anonymousPage, actors, "anonymous SSR redirect");
    await checkUnchanged("anonymous page");
    negativeChecks++;
    await deny(apiPath(a.org.id, month), undefined, 401, "anonymous API GET");

    // Revoke a real membership while leaving the signed-in user session intact.
    const [revoked] = await db.update(schema.userOrganizations).set({ active: false })
      .where(and(eq(schema.userOrganizations.userId, a.owner.id),
        eq(schema.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked?.userId, a.owner.id);
    baseline.set(a.org.id, await snapshot(a.org.id));
    await deny(pagePath(a.org.id), a.cookie, 404, "revoked owner SSR");
    await deny(apiPath(a.org.id, month), a.cookie, 403, "revoked owner GET");

    assert.equal(ownPages, 3);
    assert.equal(ownApi, 3);
    assert.equal(foreignDenials, 6);
    assert.equal(negativeChecks, 20);
    await checkUnchanged("final read-only SQL checks");
    console.log(JSON.stringify({ family: "hcm-team-leave-calendar-ssr-and-get",
      fictionalPg16: true, twoIndependentOwnerReads: 2,
      ownPages, ownApi, foreignDenials, negativeChecks,
      realLeaveSources: actors.reduce((n, actor) => n + actor.leaves.length, 0),
      unitScope: "verified against different-unit source leave",
      higherIdVictim: true, protectedSqlUnchanged: true,
      methodCoverageCredits: 0, pageCoverageCredits: 0,
      independentlyAccepted: false, productionCertified: false }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-team-leave-http.mjs"))
  await proveTeamLeaveIsolation();
