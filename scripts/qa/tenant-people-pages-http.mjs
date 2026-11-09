/**
 * Two independent owner sessions, a higher-ID real victim, source-backed own
 * successes, actual foreign 404/403 denials and unchanged PostgreSQL rows.
 *
 * Run ONLY from the dedicated PG16 GitHub Actions workflow. This does not
 * promote the two page/action GAPs or certify production tenant isolation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PEOPLE_PAGE_ORIGIN, requireDisposablePeoplePagesEnv,
  assertNoOtherEmployerMarkers, assertOwnGoalsPage, assertOwnEngagementPage,
  assertOwnSurveyApi, assertDeniedPage, assertDeniedApi,
} from "./tenant-people-pages-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));

async function readLocal(path, cookie) {
  assert.ok(path.startsWith("/") && !path.startsWith("//"), "Only loopback paths allowed");
  assert.ok(path.startsWith("/app/engagement?") ||
    path.startsWith("/app/goals-reviews?") ||
    path.startsWith("/api/hcm/engagement-surveys?") ||
    path === "/api/account" ||
    path === "/app/engagement" || path === "/app/goals-reviews",
    "Unreviewed route refused: " + path);
  const response = await fetch(PEOPLE_PAGE_ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* Dedicated assertions reject malformed JSON. */ }
  }
  return { status: response.status, text, json, location: response.headers.get("location") };
}

export async function verifyPeoplePagesTenantIsolation() {
  // Guard FIRST, before any app module, transaction or database import.
  requireDisposablePeoplePagesEnv();

  const [{ db, pool }, s, { and, asc, eq }, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const subjects = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = { ...(await fixtures.seedEmployer(label, nonce,
        fixtures.standaloneMakeSession)), label };
      await db.insert(s.performanceCycles).values({
        organizationId: actor.org.id,
        name: actor.marker + " review cycle",
        startDate: "2026-10-01", endDate: "2026-12-31",
        createdByUserId: actor.owner.id, createdBy: actor.owner.name,
      });
      await db.insert(s.engagementSurveys).values({
        organizationId: actor.org.id,
        question: actor.marker + " How is your work experience?",
        status: "closed", createdByUserId: actor.owner.id,
      });
      subjects.push(actor);
    }
    const [a, b, victim] = subjects;
    assert.equal(new Set(subjects.map(x => x.org.id)).size, 3);
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    for (const attacker of [a, b]) {
      for (const field of ["org", "entity", "unit", "owner", "worker"]) {
        assert.ok(victim[field].id > attacker[field].id,
          "Victim must have real higher persisted " + field + " ID");
      }
    }

    const [scopedUser] = await db.insert(s.users).values({
      email: "people-scoped-" + nonce + "@example.invalid",
      name: "Fictional unit-only HR", passwordHash: "fictional-session-only",
      role: "owner",
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: scopedUser.id, organizationId: a.org.id,
      role: "hr", orgUnitId: a.unit.id, active: true,
    });
    const scopedSession = await fixtures.standaloneMakeSession(scopedUser.id);

    const protectedTables = [
      "organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "performanceCycles", "engagementSurveys",
      "userOrganizations", "auditEvents", "payrollRuns",
    ];
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Persisted table missing: " + name);
        result[name] = await db.select().from(table)
          .where(name === "organizations"
            ? eq(table.id, orgId) : eq(table.organizationId, orgId))
          .orderBy(asc(table.id));
      }
      return plain(result);
    }
    const before = new Map(await Promise.all(subjects.map(async actor =>
      [actor.org.id, await snapshot(actor.org.id)])));

    const goals = id => "/app/goals-reviews?organizationId=" + id;
    const engagement = id => "/app/engagement?organizationId=" + id;
    const surveys = id => "/api/hcm/engagement-surveys?organizationId=" + id;

    let ownPairs = 0, foreignPairs = 0, malformedDenials = 0;
    for (const actor of [a, b]) {
      const otherEmployers = subjects.filter(x => x.org.id !== actor.org.id);
      const session = await readLocal("/api/account", actor.cookie);
      assert.equal(session.status, 200, "Real signed-in owner session required");
      assert.equal(session.json?.profile?.id, actor.owner.id);

      assertOwnGoalsPage(await readLocal(goals(actor.org.id), actor.cookie),
        actor, otherEmployers);
      assertOwnEngagementPage(await readLocal(engagement(actor.org.id), actor.cookie),
        actor, otherEmployers);
      assertOwnSurveyApi(await readLocal(surveys(actor.org.id), actor.cookie),
        actor, otherEmployers);
      // Backward-compatible, authenticated no-selector navigation may choose
      // only the current active primary employer, never a foreign workspace.
      assertOwnGoalsPage(await readLocal("/app/goals-reviews", actor.cookie),
        actor, otherEmployers);
      assertOwnEngagementPage(await readLocal("/app/engagement", actor.cookie),
        actor, otherEmployers);
      ownPairs++;

      for (const other of otherEmployers) {
        assertDeniedPage(await readLocal(goals(other.org.id), actor.cookie),
          subjects, actor.label + " foreign Goals " + other.label);
        assertDeniedPage(await readLocal(engagement(other.org.id), actor.cookie),
          subjects, actor.label + " foreign Engagement " + other.label);
        assertDeniedApi(await readLocal(surveys(other.org.id), actor.cookie),
          subjects, actor.label + " foreign survey API " + other.label);
        foreignPairs++;
      }
      for (const supplied of ["0", "-1", "01", "1e0", "1.0", "bad",
        "9007199254740992", "", "%20"]) {
        for (const page of [goals, engagement]) {
          assertDeniedPage(await readLocal(page(supplied), actor.cookie),
            subjects, actor.label + " malformed " + supplied);
          malformedDenials++;
        }
      }
      for (const page of [goals, engagement]) {
        assertDeniedPage(await readLocal(page(actor.org.id) +
          "&organizationId=" + actor.org.id, actor.cookie),
        subjects, actor.label + " duplicate employer selector");
        malformedDenials++;
      }
      for (const other of subjects) {
        assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id),
          actor.label + " reads changed " + other.label + " persisted state");
      }
    }
    assert.equal(ownPairs, 2);
    assert.equal(foreignPairs, 4);
    assert.equal(malformedDenials, 40);

    for (const page of [goals, engagement]) {
      assertDeniedPage(await readLocal(page(a.org.id), scopedSession.cookie),
        subjects, "unit-only HR cannot access employer-wide People SSR");
    }
    assertDeniedApi(await readLocal(surveys(a.org.id), scopedSession.cookie),
      subjects, "unit-only HR survey API");
    for (const page of [goals, engagement]) {
      const anonymous = await readLocal(page(victim.org.id));
      assert.ok([307, 308].includes(anonymous.status), "Anonymous session must redirect to login");
      assertNoOtherEmployerMarkers(anonymous.text, subjects, "anonymous People page");
      assert.ok(anonymous.location?.includes("/login"));
    }

    // Revoke a real employer membership while leaving its session alive.
    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1, "Exactly one owner grant revoked");
    assert.equal((await readLocal("/api/account", a.cookie)).status, 200,
      "Membership denial must not be explained by session logout");
    for (const page of [goals, engagement]) {
      assertDeniedPage(await readLocal(page(a.org.id), a.cookie), subjects,
        "same authenticated session, revoked employer");
      assertDeniedPage(await readLocal(
        page === goals ? "/app/goals-reviews" : "/app/engagement", a.cookie), subjects,
        "same authenticated session, removed primary employer");
    }
    assertDeniedApi(await readLocal(surveys(a.org.id), a.cookie),
      subjects, "same authenticated session, revoked survey API");

    for (const other of [b, victim]) {
      assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id),
        "Revocation must never change unrelated employer " + other.label);
    }
    const ownAfter = await snapshot(a.org.id);
    for (const name of protectedTables) {
      if (name === "userOrganizations") {
        assert.deepEqual(
          ownAfter[name].filter(row => row.userId !== a.owner.id),
          before.get(a.org.id)[name].filter(row => row.userId !== a.owner.id),
          "Only revoked owner's actual membership may differ");
      } else {
        assert.deepEqual(ownAfter[name], before.get(a.org.id)[name],
          "Business, People, payroll and audit rows must remain unchanged: " + name);
      }
    }
    assert.ok(ownAfter.userOrganizations.some(row =>
      row.userId === a.owner.id && row.active === false));
    const result = {
      kind: "PEOPLE_PAGES_SYNTHETIC_PG16_HTTP_NOT_TENANT_CERTIFICATION",
      employers: 3, independentOwners: 2, ownPageAndApiSets: ownPairs,
      crossEmployerPageAndApiSets: foreignPairs,
      malformedAndDuplicatePageDenials: malformedDenials,
      revokedSessionStillSignedIn: true, unitOnlyHrDenied: true,
      victimBusinessAndAuditUnchanged: true,
      pageCredits: 0, methodCredits: 0, productionCertified: false,
    };
    console.log("PEOPLE_PAGES_HTTP_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-people-pages-http.mjs")) {
  verifyPeoplePagesTenantIsolation().catch(error => {
    console.error("PEOPLE_PAGES_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
