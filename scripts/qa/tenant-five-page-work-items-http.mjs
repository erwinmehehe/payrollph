/** Current-source HR Work Queue SSR and GET proof. No provider, money, live DB or page source writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, API, requireFictionalEnv, verifyWorkItemsSource,
  assertOwnedPage, assertOwnedApi, assertDenied, assertNoForeignData,
} from "./tenant-five-page-work-items-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const page = id => PAGE + "?organizationId=" + id;
const api = id => API + "?organizationId=" + id;
async function request(path, cookie) {
  assert.ok(path === "/api/account" || path.startsWith(PAGE + "?") ||
    path.startsWith(API + "?"), "WORK_ITEMS_REFUSED: HTTP target escaped local scope");
  const response = await fetch(ORIGIN + path, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSR is HTML */ }
  return { status: response.status, text, json, headers: response.headers,
    location: response.headers.get("location") };
}
export async function proveFivePageWorkItems() {
  requireFictionalEnv();
  verifyWorkItemsSource();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const tables = ["organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "automationOperationalCases", "auditEvents", "payrollRuns"];
  async function snapshot(organizationId) {
    const state = {};
    for (const name of tables) {
      const table = s[name];
      assert.ok(table?.id, "WORK_ITEMS_REFUSED: missing protected table " + name);
      state[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, organizationId))
        .orderBy(asc(table.id)));
    }
    return state;
  }
  let ownPages = 0, ownApis = 0, foreignDenials = 0, denied = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "WORK_ITEMS_REFUSED: PG16 only");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "WORK_ITEMS_REFUSED: nonempty DB");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "WORK_ITEMS_REFUSED: nonempty users");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    async function actor(label) {
      const out = { ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)), label };
      const [caseRow] = await db.insert(s.automationOperationalCases).values({
        organizationId: out.org.id, caseType: "payroll_readiness",
        sourceType: "fictional_pg16_page_credit", sourceId: out.worker.id,
        employeeId: out.worker.id, ownerTeam: "HR Operations",
        assignedOwnerUserId: out.owner.id,
        title: out.marker + " protected HR case",
        detail: out.marker + " fictional work queue evidence",
        status: "open",
      }).returning();
      out.task = caseRow;
      return out;
    }
    const fillers = [];
    for (let i = 1; i <= 7; i++) fillers.push(await actor("FILL" + i));
    const a = await actor("ATTA"), b = await actor("ATTB"), victim = await actor("VICTIM");
    const all = [...fillers, a, b, victim];
    for (const key of ["org", "owner", "worker", "entity", "unit"])
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id, 6),
        "WORK_ITEMS_REFUSED: higher-ID real victim " + key);
    assert.ok(victim.task.id > Math.max(a.task.id, b.task.id, 6),
      "WORK_ITEMS_REFUSED: real victim case ID required");
    assert.equal(new Set([a.cookie, b.cookie, victim.cookie]).size, 3);
    const before = new Map();
    for (const current of all) before.set(current.org.id, await snapshot(current.org.id));
    async function unchanged(label) {
      for (const current of all) assert.deepEqual(await snapshot(current.org.id),
        before.get(current.org.id), label + " / protected " + current.label);
    }
    async function refuse(path, cookie, status, label) {
      const response = await request(path, cookie);
      assertDenied(response, status, all, label);
      denied++;
      await unchanged(label);
    }

    for (const current of [a, b]) {
      const others = all.filter(x => x !== current);
      const loggedIn = await request("/api/account", current.cookie);
      assert.equal(loggedIn.status, 200, "Own session must authenticate");
      assert.equal(loggedIn.json?.profile?.id, current.owner.id);
      assertOwnedPage(await request(page(current.org.id), current.cookie), current, others);
      ownPages++;
      assertOwnedApi(await request(api(current.org.id), current.cookie),
        current, others, current.task.id);
      ownApis++;
      await unchanged("authorized read is read-only " + current.label);

      for (const other of [a, b, victim].filter(x => x !== current)) {
        await refuse(page(other.org.id), current.cookie, 404,
          current.label + " foreign SSR " + other.label);
        await refuse(api(other.org.id), current.cookie, 403,
          current.label + " foreign API " + other.label);
        foreignDenials += 2;
      }
      for (const malformed of ["0", "01", "1e0", "-1", "99999999999999999999999", "bad"]) {
        await refuse(page(malformed), current.cookie, 404,
          current.label + " forged/noncanonical SSR " + malformed);
      }
      await refuse(page(current.org.id + "&organizationId=" + victim.org.id),
        current.cookie, 404, current.label + " duplicate employer selector");
      await refuse(page(victim.org.id + "&organizationId=" + current.org.id),
        current.cookie, 404, current.label + " reversed duplicate employer");
      // Unknown worker/case business IDs must never replace the page employer selector.
      await refuse(page(victim.task.id), current.cookie, 404,
        current.label + " case ID is not authorized employer ID");
    }

    const anon = await request(page(victim.org.id));
    assert.ok([307, 308].includes(anon.status), "Anonymous SSR must redirect to login");
    assert.ok(anon.location?.includes("/login"));
    assertNoForeignData(anon, all, "anonymous SSR");
    denied++;
    await refuse(api(victim.org.id), undefined, 401, "anonymous API");
    const [inactive] = await db.insert(s.users).values({
      email: "work-items-inactive-" + nonce + "@example.invalid",
      name: "Fictional inactive", passwordHash: "not-real", role: "owner", active: false,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: inactive.id, organizationId: victim.org.id, role: "owner", active: true,
    });
    const inactiveSession = await fixture.standaloneMakeSession(inactive.id);
    before.set(victim.org.id, await snapshot(victim.org.id));
    await refuse(page(victim.org.id), inactiveSession.cookie, 307,
      "inactive account cannot mount protected page");
    await refuse(api(victim.org.id), inactiveSession.cookie, 401,
      "inactive account cannot query protected API");
    const [revoked] = await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.userId, a.owner.id),
      eq(s.userOrganizations.organizationId, a.org.id),
    )).returning();
    assert.equal(revoked.userId, a.owner.id, "Fixture must revoke real membership");
    before.set(a.org.id, await snapshot(a.org.id));
    const stillSignedIn = await request("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200, "Revoked tenant membership must not log out account");
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    await refuse(page(a.org.id), a.cookie, 404, "revoked employer SSR");
    await refuse(api(a.org.id), a.cookie, 403, "revoked employer API");
    assert.equal(ownPages, 2);
    assert.equal(ownApis, 2);
    assert.equal(foreignDenials, 8);
    assert.ok(denied >= 30, "Every malicious selector, denied role and revocation checked");
    console.log("FIVE_SCOPED_WORK_ITEMS_PG16 " + JSON.stringify({
      ownPages, ownApis, foreignDenials, negativeChecks: denied,
      realHigherIdVictim: true, unchangedProtectedSql: true,
      failedUnauthorizedPrivateRows: 0, apiMethodCredits: 0, pageCreditsAtProofTime: 0,
      evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", independentReview: "PENDING",
      productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("tenant-five-page-work-items-http.mjs"))
  await proveFivePageWorkItems();
