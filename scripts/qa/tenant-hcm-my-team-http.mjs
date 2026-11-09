/**
 * Independent HCM My Team tenant-isolation proof: exact source + real localhost
 * HTTP against a disposable, empty PostgreSQL 16. No runtime or ledger changes.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE_PATH, API_PATH, requireDisposableMyTeamEnv,
  verifyMyTeamSourcePins, assertNoMarkers, assertOwnedPage,
  assertOwnedApi, assertDenied, assertUnchangedSql,
} from "./tenant-hcm-my-team-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
async function httpGet(path, cookie) {
  const response = await fetch(ORIGIN + path, {
    headers: cookie ? { cookie } : {}, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSR or non-JSON refusal */ }
  return { status: response.status, text, json, headers: response.headers };
}
const pagePath = org => PAGE_PATH + "?organizationId=" + org;
const apiPath = (org, extra = "") => API_PATH + "?organizationId=" + org + extra;

export async function proveHcmMyTeamIsolation() {
  // Abort before importing DB, auth, fixtures, or source modules.
  requireDisposableMyTeamEnv();
  verifyMyTeamSourcePins();
  const [{ db, pool }, s, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { asc, eq, and } = orm;
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "leaveRequests", "overtimeRequests",
    "attendanceCorrectionRequests", "timePunches", "auditEvents",
    "permissionSets", "userPermissionAssignments",
  ];
  async function snapshot(organizationId) {
    const out = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id, "Missing protected table primary key: " + name);
      const key = name === "organizations" ? table.id : table.organizationId;
      assert.ok(key, "Missing protected employer boundary column: " + name);
      out[name] = plain(await db.select().from(table)
        .where(eq(key, organizationId)).orderBy(asc(table.id)));
    }
    return out;
  }

  let ownPages = 0, ownApi = 0, foreignDenials = 0, negativeChecks = 0;
  try {
    const pgVersion = Number((await pool.query("SHOW server_version_num"))
      .rows[0].server_version_num);
    assert.ok(pgVersion >= 160000 && pgVersion < 170000,
      "MY_TEAM_REFUSED: actual PostgreSQL 16 is required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "MY_TEAM_REFUSED: disposable app_db must start without employers");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "MY_TEAM_REFUSED: disposable app_db must start without user accounts");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = {
        ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)), label,
      };
      actor.privateBank = "FICTIONAL-BANK-PRIVATE-" + label + "-" + nonce;
      actor.privateTax = "FICTIONAL-TAX-PRIVATE-" + label + "-" + nonce;
      actor.privateLeaveReason = "FICTIONAL-LEAVE-PRIVATE-" + label + "-" + nonce;
      await db.update(s.employees).set({
        bankAccount: actor.privateBank, tin: actor.privateTax,
      }).where(eq(s.employees.id, actor.worker.id));
      const [otherUnit] = await db.insert(s.orgUnits).values({
        organizationId: actor.org.id, legalEntityId: actor.entity.id,
        type: "department", name: actor.marker + " other unit",
        code: actor.marker.slice(0, 26) + "-OTHER",
      }).returning();
      const [otherWorker] = await db.insert(s.employees).values({
        organizationId: actor.org.id, legalEntityId: actor.entity.id,
        orgUnitId: otherUnit.id, employeeNo: actor.marker + "-2",
        firstName: "Other", lastName: actor.marker + "-unit",
        title: "Fictional team worker", avatarInitials: "FW",
        basicRate: "20000.00", startDate: "2026-01-05",
        bankAccount: actor.privateBank, tin: actor.privateTax,
      }).returning();
      actor.otherUnit = otherUnit;
      actor.otherWorker = otherWorker;
      const makeLeave = (worker, status) => ({
        organizationId: actor.org.id, employeeId: worker.id,
        leaveType: "Annual", startDate: "2026-11-10", endDate: "2026-11-10",
        days: "1.0", reason: actor.privateLeaveReason, status,
      });
      const [homeLeave] = await db.insert(s.leaveRequests)
        .values(makeLeave(actor.worker, "Pending")).returning();
      const [otherLeave] = await db.insert(s.leaveRequests)
        .values(makeLeave(otherWorker, "Pending")).returning();
      const [notPending] = await db.insert(s.leaveRequests)
        .values(makeLeave(actor.worker, "Approved")).returning();
      actor.leaves = [homeLeave, otherLeave];
      actor.notPending = notPending;
      actors.push(actor);
    }
    const [a, b, victim] = actors;
    assert.equal(new Set(actors.map(x => x.cookie)).size, 3);
    assert.equal(new Set(actors.map(x => x.org.id)).size, 3);
    for (const key of ["org", "owner", "worker", "otherWorker"]) {
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id),
        "A real higher-ID third-employer " + key + " is required");
    }
    assert.ok(victim.leaves.every(x =>
      x.id > Math.max(...a.leaves.map(y => y.id), ...b.leaves.map(y => y.id))),
      "Victim's actual pending leave IDs must be strictly higher");

    async function addRole(role, orgUnitId, suffix) {
      const [user] = await db.insert(s.users).values({
        email: "my-team-" + role + "-" + suffix + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " My Team account",
        passwordHash: "fixture-no-login", role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: user.id, role, orgUnitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const manager = await addRole("manager", a.unit.id, "unit");
    const hrUnit = await addRole("hr", a.unit.id, "hr-unit");
    const bookkeeper = await addRole("bookkeeper", null, "bookkeeper");
    const unassignedManager = await addRole("manager", null, "unassigned");

    const baseline = new Map();
    for (const actor of actors) baseline.set(actor.org.id, await snapshot(actor.org.id));
    const verifyUnchanged = async label => {
      for (const actor of actors) {
        assertUnchangedSql(baseline.get(actor.org.id),
          await snapshot(actor.org.id), label + ": " + actor.label);
      }
    };
    const deny = async (path, cookie, expected, label) => {
      const response = await httpGet(path, cookie);
      assertDenied(response, expected, actors, label);
      await verifyUnchanged(label);
      negativeChecks++;
      return response;
    };
    const ownApiRequest = async (actor, cookie, expected, scope, suffix = "",
      option = {}) => {
      const response = await httpGet(apiPath(actor.org.id, suffix), cookie);
      assertOwnedApi(response, actor,
        actors.filter(x => x !== actor), expected, scope, option);
      await verifyUnchanged("own " + actor.label + " " + suffix);
      ownApi++;
      return response;
    };
    const ownPageRequest = async (actor, cookie) => {
      const response = await httpGet(pagePath(actor.org.id), cookie);
      assertOwnedPage(response, actor, actors.filter(x => x !== actor));
      await verifyUnchanged("own " + actor.label + " SSR");
      ownPages++;
      return response;
    };

    for (const actor of [a, b]) {
      await ownPageRequest(actor, actor.cookie);
      const allWorkers = [actor.worker, actor.otherWorker];
      await ownApiRequest(actor, actor.cookie, allWorkers, {
        kind: "company", orgUnitId: null,
      });
      await ownApiRequest(actor, actor.cookie, allWorkers, {
        kind: "company", orgUnitId: null,
      }, "&status=Active", { status: "Active" });
      await ownApiRequest(actor, actor.cookie, [actor.otherWorker], {
        kind: "company", orgUnitId: null,
      }, "&cursor=" + actor.worker.id, { cursor: actor.worker.id });
      await ownApiRequest(actor, actor.cookie, allWorkers, {
        kind: "company", orgUnitId: null,
      }, "&q=" + encodeURIComponent(actor.marker), { query: actor.marker });

      // A real victim ID and another real employer selector cannot be read.
      await deny(pagePath(victim.org.id), actor.cookie, 404,
        actor.label + " foreign SSR");
      await deny(apiPath(victim.org.id), actor.cookie, 403,
        actor.label + " real victim source GET");
      foreignDenials += 2;
      await deny(pagePath("01"), actor.cookie, 404,
        actor.label + " noncanonical page selector");
      await deny(apiPath("01"), actor.cookie, 400,
        actor.label + " noncanonical API selector");
      await deny(pagePath(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 404, actor.label + " duplicate page selector");
      await deny(apiPath(actor.org.id, "&cursor=-1"), actor.cookie, 400,
        actor.label + " negative cursor");
      await deny(apiPath(actor.org.id, "&status=__not-a-status__"),
        actor.cookie, 400, actor.label + " invalid status");
      await deny(apiPath(actor.org.id, "&q=" + "x".repeat(71)),
        actor.cookie, 400, actor.label + " oversized search");

      const escapedSearch = await httpGet(apiPath(actor.org.id, "&q=%25_"),
        actor.cookie);
      assert.equal(escapedSearch.status, 200,
        "An escaped wildcard search must be a valid, scoped empty result");
      assert.equal(escapedSearch.json?.organizationId, actor.org.id);
      assert.deepEqual(escapedSearch.json?.items, [],
        "Escaped wildcard must not become unbounded search");
      assertNoMarkers(escapedSearch, actors.filter(x => x !== actor),
        "escaped wildcard query");
      await verifyUnchanged("escaped wildcard search");
    }

    await ownPageRequest(a, manager.cookie);
    await ownApiRequest(a, manager.cookie, [a.worker],
      { kind: "unit", orgUnitId: a.unit.id });
    await ownPageRequest(a, hrUnit.cookie);
    await ownApiRequest(a, hrUnit.cookie, [a.worker],
      { kind: "unit", orgUnitId: a.unit.id });
    const managerDifferentUnit = await httpGet(apiPath(a.org.id,
      "&q=" + encodeURIComponent(a.otherWorker.employeeNo)), manager.cookie);
    assert.equal(managerDifferentUnit.status, 200);
    assert.deepEqual(managerDifferentUnit.json?.items, [],
      "Concrete manager unit cannot query another unit inside same employer");
    assertNoMarkers(managerDifferentUnit, [b, victim], "unit search");
    await verifyUnchanged("unit-scoped search");

    await deny(pagePath(victim.org.id), manager.cookie, 404,
      "manager foreign SSR");
    await deny(apiPath(victim.org.id), manager.cookie, 403,
      "manager foreign API");
    foreignDenials += 2;

    await deny(pagePath(a.org.id), bookkeeper.cookie, 404,
      "bookkeeper forbidden SSR");
    await deny(apiPath(a.org.id), bookkeeper.cookie, 403,
      "bookkeeper forbidden GET");
    await deny(pagePath(a.org.id), unassignedManager.cookie, 404,
      "unassigned manager forbidden SSR");
    await deny(apiPath(a.org.id), unassignedManager.cookie, 403,
      "unassigned manager forbidden GET");

    const anonPage = await httpGet(pagePath(a.org.id));
    assert.ok([307, 308].includes(anonPage.status),
      "Anonymous SSR must redirect instead of rendering employees");
    assert.ok(anonPage.headers.get("location")?.includes("/login"));
    assertNoMarkers(anonPage, actors, "anonymous SSR");
    await verifyUnchanged("anonymous SSR");
    negativeChecks++;
    await deny(apiPath(a.org.id), undefined, 401, "anonymous API GET");

    // Membership change is fixture-controlled, never a request side effect.
    const [revoked] = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked?.userId, a.owner.id,
      "Revocation must update the original owner's real membership");
    baseline.set(a.org.id, await snapshot(a.org.id));
    await deny(pagePath(a.org.id), a.cookie, 404, "revoked owner SSR");
    await deny(apiPath(a.org.id), a.cookie, 403, "revoked owner API");

    assert.equal(ownPages, 4, "Two owner shells + manager and HR scoped shells");
    assert.equal(ownApi, 10, "Eight owner GETs plus manager and HR unit GET");
    assert.equal(foreignDenials, 6, "Two owners and manager each denied page + API");
    assert.equal(negativeChecks, 26, "Every independent negative case executed");
    await verifyUnchanged("final scoped database invariant");

    console.log(JSON.stringify({
      family: "hcm-my-team-ssr-and-get",
      fictionalPg16: true, twoIndependentOwners: true,
      higherIdThirdEmployer: true, realEmployees: actors.length * 2,
      realPendingLeaveSources: actors.length * 2,
      ownPages, ownApi, foreignDenials, negativeChecks,
      unitManagerAndHrScoped: true, protectedSqlUnchanged: true,
      privateSourceDataExcluded: true, liveProviderCalls: 0,
      methodCoverageCredits: 0, pageCoverageCredits: 0,
      accepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-hcm-my-team-http.mjs")) {
  await proveHcmMyTeamIsolation();
}
