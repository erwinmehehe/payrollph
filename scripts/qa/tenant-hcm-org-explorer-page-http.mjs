/**
 * Genuine HCM Organization Explorer SSR + graph/history HTTP isolation.
 * Disposable fictional PostgreSQL 16 and localhost production Next ONLY.
 * This never grants page/method credits or activation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, GRAPH, HISTORY,
  requireFictionalEnvironment, verifySources,
  assertOwnPage, assertOwnGraph, assertOwnHistory,
  assertDenied, assertNoTenantLeak, assertSqlUnchanged
} from "./tenant-hcm-org-explorer-page-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const pageUrl = org => PAGE + "?organizationId=" + org;
const graphUrl = org => GRAPH + "?organizationId=" + org;
const historyUrl = (org, position) =>
  HISTORY + "?organizationId=" + org + "&positionId=" + position;

async function httpGet(path, cookie) {
  assert.ok(path === "/api/account" ||
    [PAGE + "?", GRAPH + "?", HISTORY + "?"].some(start => path.startsWith(start)),
    "ORG_EXPLORER_PROOF_REFUSED: out-of-scope HTTP target " + path);
  assert.ok(!path.includes("#") && !path.includes("://") && !path.startsWith("//"));
  const response = await fetch(ORIGIN + path, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML, redirect, or generic denial */ }
  return { status: response.status, text, headers: response.headers, json };
}

export async function proveOrgExplorerPageIsolation() {
  // Both checks MUST precede importing schema, DB, auth, fixture, or network.
  requireFictionalEnvironment();
  verifySources();

  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs")
  ]);
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "jobProfiles", "positions",
    "positionAssignments", "auditEvents", "payrollRuns", "payoutBatches"
  ];
  const snapshot = async orgId => {
    const data = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id && (name === "organizations" || table.organizationId),
        "Missing employer-scoped protected SQL source: " + name);
      data[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
        .orderBy(asc(table.id)));
    }
    return data;
  };

  let ownPages = 0, ownGraphs = 0, ownHistories = 0;
  let foreignDenials = 0, negativeChecks = 0;

  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "ORG_EXPLORER_PROOF_REFUSED: PG16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "ORG_EXPLORER_PROOF_REFUSED: nonempty employer database");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "ORG_EXPLORER_PROOF_REFUSED: nonempty user database");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    async function seed(label) {
      const actor = {
        ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)),
        label
      };
      actor.secrets = ["ORG-PRIVATE-BANK-" + label + "-" + nonce,
        "ORG-PRIVATE-TAX-" + label + "-" + nonce];
      await db.update(s.employees)
        .set({ bankAccount: actor.secrets[0], tin: actor.secrets[1] })
        .where(eq(s.employees.id, actor.worker.id));

      const [profile] = await db.insert(s.jobProfiles)
        .values({ organizationId: actor.org.id, title: "Org Chart " + actor.marker })
        .returning();
      const [position] = await db.insert(s.positions).values({
        organizationId: actor.org.id, code: "ORG-" + label + "-" + nonce,
        jobProfileId: profile.id, orgUnitId: actor.unit.id,
        supervisoryOrgUnitId: actor.unit.id, status: "open"
      }).returning();
      actor.position = position;
      const [assignment] = await db.insert(s.positionAssignments).values({
        organizationId: actor.org.id, positionId: position.id,
        employeeId: actor.worker.id, effectiveFrom: "2026-01-01"
      }).returning();
      actor.assignment = assignment;
      return actor;
    }

    const filler = [];
    for (let i = 1; i <= 7; i++) filler.push(await seed("FILL" + i));
    const a = await seed("ATTA");
    const b = await seed("ATTB");
    const victim = await seed("VICTIM");
    const actors = [a, b, victim], all = [...filler, ...actors];

    assert.deepEqual(actors.map(item => item.org.id), [8, 9, 10],
      "The gate's exact fictional allowlist must match seeded employer IDs");
    assert.equal(new Set(actors.map(item => item.cookie)).size, 3);
    for (const name of ["org", "entity", "unit", "worker", "owner", "position", "assignment"])
      assert.ok(victim[name].id > Math.max(a[name].id, b[name].id, 6),
        "Real populated victim ID must exceed both independent owners: " + name);

    async function roleUser(role, orgUnitId) {
      const [user] = await db.insert(s.users).values({
        email: "org-explorer-" + role + "-" + (orgUnitId ?? "company") + "-" + nonce +
          "@example.invalid",
        name: "Fictional " + role + " org reader",
        passwordHash: "fixture-only", role: "owner", totpEnabled: true
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: user.id, role, orgUnitId, active: true
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }

    const companyHr = await roleUser("hr", null);
    const unitHr = await roleUser("hr", a.unit.id);
    const bookkeeper = await roleUser("bookkeeper", null);

    const baselines = new Map();
    for (const actor of all) baselines.set(actor.org.id, await snapshot(actor.org.id));
    async function unchanged(label) {
      for (const actor of all) assertSqlUnchanged(
        baselines.get(actor.org.id), await snapshot(actor.org.id),
        label + " / " + actor.label);
    }
    async function deny(path, cookie, expected, label, foreign = false) {
      const response = await httpGet(path, cookie);
      assertDenied(response, expected, all, label);
      negativeChecks++;
      if (foreign) foreignDenials++;
    }
    async function own(actor, cookie) {
      assertOwnPage(await httpGet(pageUrl(actor.org.id), cookie), actor, all);
      ownPages++;
      assertOwnGraph(await httpGet(graphUrl(actor.org.id), cookie), actor, all);
      ownGraphs++;
      assertOwnHistory(await httpGet(
        historyUrl(actor.org.id, actor.position.id), cookie), actor, all);
      ownHistories++;
    }

    for (const actor of [a, b]) {
      const login = await httpGet("/api/account", actor.cookie);
      assert.equal(login.status, 200, "Real signed-in tenant owner required");
      assert.equal(login.json?.profile?.id, actor.owner.id);
      await own(actor, actor.cookie);
      await unchanged(actor.label + " owned SSR, graph and history");

      for (const other of actors.filter(item => item !== actor)) {
        await deny(pageUrl(other.org.id), actor.cookie, 404,
          actor.label + " foreign employer page", true);
        await deny(graphUrl(other.org.id), actor.cookie, 403,
          actor.label + " foreign employer graph", true);
        await deny(historyUrl(other.org.id, other.position.id), actor.cookie, 403,
          actor.label + " foreign employer history", true);
        await deny(historyUrl(actor.org.id, other.position.id), actor.cookie, 404,
          actor.label + " forged foreign position under own employer", true);
      }

      for (const invalid of ["0", "01", "1e0", "-1", "bad", "99999999999999999999999999"]) {
        await deny(pageUrl(invalid), actor.cookie, 404,
          actor.label + " malformed SSR employer " + invalid);
        await deny(graphUrl(invalid), actor.cookie, 400,
          actor.label + " malformed graph employer " + invalid);
        await deny(historyUrl(actor.org.id, invalid), actor.cookie, 400,
          actor.label + " malformed history position " + invalid);
      }
      // Every selector rejects ambiguity rather than silently choosing a first
      // organization or position, even when the duplicate values are identical.
      await deny(pageUrl(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 404, actor.label + " duplicate SSR employer");
      await deny(graphUrl(actor.org.id + "&organizationId=" + victim.org.id),
        actor.cookie, 400, actor.label + " duplicated foreign graph employer");
      await deny(graphUrl(actor.org.id + "&organizationId=" + actor.org.id),
        actor.cookie, 400, actor.label + " duplicated same graph employer");
      await deny(historyUrl(actor.org.id + "&organizationId=" + victim.org.id,
        actor.position.id), actor.cookie, 400, actor.label + " duplicated history employer");
      await deny(historyUrl(actor.org.id, actor.position.id + "&positionId=" + victim.position.id),
        actor.cookie, 400, actor.label + " duplicated foreign history position");

      await unchanged(actor.label + " foreign/forged/malformed denials");
    }

    await own(a, companyHr.cookie);
    for (const [label, person] of [
      ["unit HR", unitHr], ["bookkeeper", bookkeeper]
    ]) {
      await deny(pageUrl(a.org.id), person.cookie, 404, label + " SSR denied");
      await deny(graphUrl(a.org.id), person.cookie, 403, label + " graph denied");
      await deny(historyUrl(a.org.id, a.position.id), person.cookie, 403,
        label + " history denied");
    }

    const anonymous = await httpGet(pageUrl(a.org.id));
    assert.ok([307, 308].includes(anonymous.status),
      "Anonymous page must redirect instead of exposing organization data");
    assert.ok(anonymous.headers.get("location")?.includes("/login"));
    assertNoTenantLeak(anonymous, all, "anonymous SSR");
    negativeChecks++;
    await deny(graphUrl(a.org.id), undefined, 401, "anonymous graph");
    await deny(historyUrl(a.org.id, a.position.id), undefined, 401, "anonymous history");
    await unchanged("anonymous/role denials");

    const [revoked] = await db.update(s.userOrganizations)
      .set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked?.userId, a.owner.id);
    baselines.set(a.org.id, await snapshot(a.org.id));
    const loggedInAfterRevoke = await httpGet("/api/account", a.cookie);
    assert.equal(loggedInAfterRevoke.status, 200);
    assert.equal(loggedInAfterRevoke.json?.profile?.id, a.owner.id);
    await deny(pageUrl(a.org.id), a.cookie, 404, "revoked owner SSR");
    await deny(graphUrl(a.org.id), a.cookie, 403, "revoked owner graph");
    await deny(historyUrl(a.org.id, a.position.id), a.cookie, 403,
      "revoked owner history");
    await unchanged("post-revocation protected rows");

    assert.equal(ownPages, 3, "Two owners and independent company-wide HR page");
    assert.equal(ownGraphs, 3);
    assert.equal(ownHistories, 3);
    assert.equal(foreignDenials, 16, "Every cross-employer page/graph/history/object control");
    assert.ok(negativeChecks >= 73, "Adversarial negative HTTP coverage must not shrink");

    console.log(JSON.stringify({
      family: "hcm-org-explorer-page-graph-history", fictionalPg16: true,
      populatedEmployers: all.length, independentOwnerSessions: 2,
      higherIdVictim: true, ownPages, ownGraphs, ownHistories,
      foreignDenials, negativeChecks, verifiedProtectedTables: protectedTables.length,
      immutableEmployerAndAuditSql: true, revokedMembershipDenied: true,
      serverRenderedPageAndBothReadApis: true, clientBrowserInteractionsProven: false,
      duplicateApiSelectorsProven: true, pageActionCredits: 0, apiMethodCredits: 0,
      independentlyAccepted: false, productionCertified: false,
      realUsers: 0, externalProviders: 0, moneyMoved: false
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/")
    .endsWith("scripts/qa/tenant-hcm-org-explorer-page-http.mjs"))
  await proveOrgExplorerPageIsolation();