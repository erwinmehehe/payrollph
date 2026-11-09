/**
 * Independent employee participation + five-response privacy acceptance for
 * /app/engagement and /api/hcm/engagement-surveys GET/POST.
 * Real localhost HTTP against disposable PostgreSQL 16, NO providers,
 * no tenant method credit, no UI hydration claim, no production activation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ORIGIN, API_PATH, ENGAGEMENT_SOURCE_PINS, gitBlobSha,
  requireDisposableEngagementEmployeeEnv, assertNoForeignMarkers,
  assertOwnEmployeePage, assertSurveyRead, assertSubmittedAnswer,
  assertDenied, assertUnchanged, assertAnswerDelta, assertCloseDelta,
} from "./tenant-engagement-employee-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
function assertRoute(path, method) {
  assert.ok(method === "GET" || method === "POST", "Only reviewed HTTP methods may run");
  if (method === "POST") assert.equal(path, API_PATH, "Only survey action POST allowed");
  else assert.ok(path === "/api/account" ||
    path === "/app/engagement" || path.startsWith("/app/engagement?organizationId=") ||
    path.startsWith(API_PATH + "?organizationId="),
    "Unreviewed path refused: " + path);
}
async function local(path, { method = "GET", cookie, body, origin = ORIGIN,
  fetchSite = "same-origin" } = {}) {
  assertRoute(path, method);
  const headers = {
    ...(cookie ? { cookie } : {}),
    ...(method === "POST" ? { "content-type": "application/json",
      origin, "sec-fetch-site": fetchSite } : {}),
  };
  const res = await fetch(ORIGIN + path, {
    method, headers, body: method === "POST" ? JSON.stringify(body) : undefined,
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Status and response assertions enforce shape. */ }
  return { status: res.status, json, text, contentType: res.headers.get("content-type"),
    headers: res.headers, location: res.headers.get("location") };
}
const submit = (actor, employee, {
  organizationId = actor.org.id, surveyId = actor.survey.id,
  score = 3, origin = ORIGIN, fetchSite = "same-origin", cookie = employee.cookie,
} = {}) => local(API_PATH, { method: "POST", cookie, origin, fetchSite,
  body: { organizationId, surveyId, score, action: "answer" } });
const read = (actor, cookie, organizationId = actor.org.id) =>
  local(API_PATH + "?organizationId=" + organizationId, { cookie });
const close = (actor, { organizationId = actor.org.id,
  surveyId = actor.survey.id, cookie = actor.cookie } = {}) =>
  local(API_PATH, { method: "POST", cookie,
    body: { action: "close", organizationId, surveyId } });

export async function verifyEngagementEmployeePrivacy() {
  // Must be FIRST: no application/database module or local connection before.
  requireDisposableEngagementEmployeeEnv();
  for (const [path, sha] of Object.entries(ENGAGEMENT_SOURCE_PINS)) {
    const bytes = readFileSync(new URL("../../" + path, import.meta.url));
    assert.equal(gitBlobSha(bytes), sha,
      "ENGAGEMENT_EMPLOYEE_REFUSED: reviewed app/route/source changed: " + path);
  }

  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { and, asc, eq } = orm;
  const tracked = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "engagementSurveys",
    "engagementSurveyParticipants", "auditEvents", "payrollRuns", "outbox",
  ];
  async function snapshot(orgId) {
    const value = {};
    for (const name of tracked) {
      const table = s[name];
      assert.ok(table?.id, "Tracked table has no primary key: " + name);
      const filter = name === "organizations" ? table.id : table.organizationId;
      assert.ok(filter, "Tracked table lacks tenant column: " + name);
      value[name] = await db.select().from(table)
        .where(eq(filter, orgId)).orderBy(asc(table.id));
    }
    return plain(value);
  }

  const receipts = { acceptedRatings: 0, duplicateDenials: 0,
    foreignPostDenials: 0, sourceIdDenials: 0, privacyReads: 0,
    closedSurveys: 0, rejectedCases: 0 };
  try {
    const pgVersion = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pgVersion >= 160000 && pgVersion < 170000,
      "ENGAGEMENT_EMPLOYEE_REFUSED: PostgreSQL 16 fixture required");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "ENGAGEMENT_EMPLOYEE_REFUSED: user database must be empty before seeding");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "ENGAGEMENT_EMPLOYEE_REFUSED: employer database must be empty before seeding");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = { ...(await fixtures.seedEmployer(label, nonce,
        fixtures.standaloneMakeSession)), label };
      const [survey] = await db.insert(s.engagementSurveys).values({
        organizationId: actor.org.id,
        question: actor.marker + " How do you rate your fictional work experience?",
        createdByUserId: actor.owner.id, status: "open",
      }).returning();
      actor.survey = survey;
      const workers = [actor.worker];
      for (let index = 1; index < 6; index++) {
        workers.push(await fixtures.addWorker(actor, "E" + index));
      }
      actor.employeeSessions = [];
      for (let i = 0; i < workers.length; i++) {
        const worker = workers[i];
        const [account] = await db.insert(s.users).values({
          email: "engagement-" + label.toLowerCase() + "-" + i + "-" + nonce + "@example.invalid",
          name: actor.marker + " employee-" + i,
          passwordHash: "fictional-no-password-login", role: "employee",
          employeeId: worker.id, totpEnabled: false,
        }).returning();
        await db.insert(s.userOrganizations).values({
          organizationId: actor.org.id, userId: account.id,
          role: "employee", orgUnitId: actor.unit.id,
          workerEmployeeId: worker.id, active: true,
        });
        const session = await fixtures.standaloneMakeSession(account.id);
        actor.employeeSessions.push({ worker, account, cookie: session.cookie });
      }
      actors.push(actor);
    }
    const [a, b, victim] = actors;
    assert.equal(new Set(actors.map(x => x.org.id)).size, 3);
    assert.equal(new Set(actors.flatMap(x => [x.cookie, ...x.employeeSessions.map(y => y.cookie)])).size,
      21, "Every owner and worker must have a different signed-in session");
    for (const attacker of [a, b]) {
      for (const field of ["org", "survey", "worker", "owner", "entity"]) {
        assert.ok(victim[field].id > attacker[field].id,
          "Real higher-ID victim " + field + " required");
      }
    }
    const baseline = new Map(await Promise.all(actors.map(async actor =>
      [actor.org.id, await snapshot(actor.org.id)])));
    async function unchanged(context) {
      for (const actor of actors) {
        assertUnchanged(baseline.get(actor.org.id), await snapshot(actor.org.id),
          context + ": " + actor.label);
      }
    }
    async function denied(response, status, context) {
      assertDenied(response, status, actors, context);
      await unchanged(context);
      receipts.rejectedCases++;
    }
    function otherEmployers(actor) {
      return actors.filter(o => o !== actor);
    }

    for (const actor of [a, b]) {
      const first = actor.employeeSessions[0];
      const signedIn = await local("/api/account", { cookie: first.cookie });
      assert.equal(signedIn.status, 200, "Authentic employee session required");
      assert.equal(signedIn.json?.profile?.id, first.account.id);
      assert.equal(signedIn.json?.profile?.role, "employee");
      assertOwnEmployeePage(await local("/app/engagement?organizationId=" + actor.org.id,
        { cookie: first.cookie }), actor, otherEmployers(actor));
      assertOwnEmployeePage(await local("/app/engagement",
        { cookie: first.cookie }), actor, otherEmployers(actor));
      assertSurveyRead(await read(actor, first.cookie), actor, otherEmployers(actor),
        { employee: true, submitted: false }); receipts.privacyReads++;

      // Denials are measured BEFORE any legitimate response changes the data.
      await denied(await read(victim, first.cookie, victim.org.id), 403,
        actor.label + " real victim employer GET denied");
      const foreignPage = await local("/app/engagement?organizationId=" + victim.org.id,
        { cookie: first.cookie });
      assert.equal(foreignPage.status, 404, "Foreign SSR must not mount employee UI");
      assertNoForeignMarkers(foreignPage.text, actors, "foreign employee page");
      await unchanged(actor.label + " foreign page GET");

      await denied(await submit(actor, first, {
        organizationId: victim.org.id, surveyId: victim.survey.id, score: 5,
      }), 403, actor.label + " real victim organization POST denied");
      receipts.foreignPostDenials++;
      await denied(await submit(actor, first, {
        organizationId: actor.org.id, surveyId: victim.survey.id, score: 5,
      }), 409, actor.label + " real victim survey ID POST denied");
      receipts.sourceIdDenials++;
      const other = actor === a ? b : a;
      await denied(await submit(actor, first, {
        organizationId: actor.org.id, surveyId: other.survey.id, score: 2,
      }), 409, actor.label + " other-employer survey ID POST denied");
      receipts.sourceIdDenials++;
      await denied(await submit(actor, first, { score: 0 }), 400,
        actor.label + " zero score denied");
      await denied(await submit(actor, first, { score: 1.5 }), 400,
        actor.label + " fractional score denied");
      await denied(await submit(actor, first, { score: 6 }), 400,
        actor.label + " out-of-range score denied");
      await denied(await submit(actor, first, {
        origin: "https://cross-site.invalid", fetchSite: "cross-site",
      }), 403, actor.label + " cross-site mutation denied");

      // Owners cannot impersonate an employee by sending the same answer body.
      await denied(await submit(actor, { cookie: actor.cookie }), 403,
        actor.label + " owner impersonation denied");
    }

    // Authenticated but unlinked "employee" must not mount or submit.
    const [unlinked] = await db.insert(s.users).values({
      email: "engagement-unlinked-" + nonce + "@example.invalid",
      name: "Fictional unlinked employee", passwordHash: "fictional-only",
      role: "employee", employeeId: null,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: unlinked.id, organizationId: a.org.id, role: "employee",
      orgUnitId: a.unit.id, active: true,
    });
    const unlinkedSession = await fixtures.standaloneMakeSession(unlinked.id);
    baseline.set(a.org.id, await snapshot(a.org.id));
    const unlinkedPage = await local("/app/engagement?organizationId=" + a.org.id,
      { cookie: unlinkedSession.cookie });
    assert.equal(unlinkedPage.status, 404, "No linked worker: employee SSR denied");
    assertNoForeignMarkers(unlinkedPage.text, actors, "unlinked employee page");
    await unchanged("unlinked SSR");
    await denied(await read(a, unlinkedSession.cookie), 403,
      "unlinked employee GET denied");
    await denied(await submit(a, { cookie: unlinkedSession.cookie }), 403,
      "unlinked employee answer denied");
    await denied(await local(API_PATH, { method: "POST",
      body: { organizationId: a.org.id, surveyId: a.survey.id,
        score: 5, action: "answer" } }), 401, "anonymous answer denied");

    // One owner's survey receives four ratings; the other's receives five.
    // In both cases OPEN surveys must withhold every count and average.
    for (const [actor, scores] of [[a, [1, 2, 3, 4]], [b, [1, 2, 3, 4, 5]]]) {
      for (let i = 0; i < scores.length; i++) {
        const employee = actor.employeeSessions[i];
        const score = scores[i];
        const before = await snapshot(actor.org.id);
        const posted = await submit(actor, employee, { score });
        assertSubmittedAnswer(posted, otherEmployers(actor));
        const after = await snapshot(actor.org.id);
        assertAnswerDelta(before, after, actor, employee.worker.id, score);
        baseline.set(actor.org.id, after);
        receipts.acceptedRatings++;
        await unchanged(actor.label + " legitimate employee answer");

        assertSurveyRead(await read(actor, employee.cookie), actor, otherEmployers(actor),
          { employee: true, submitted: true });
        receipts.privacyReads++;
        const unsent = actor.employeeSessions[5];
        assertSurveyRead(await read(actor, unsent.cookie), actor, otherEmployers(actor),
          { employee: true, submitted: false });
        receipts.privacyReads++;
      }
      await denied(await submit(actor, actor.employeeSessions[0], { score: 5 }), 409,
        actor.label + " duplicate answer denied");
      receipts.duplicateDenials++;
      assertSurveyRead(await read(actor, actor.cookie), actor, otherEmployers(actor),
        { employee: false });
      receipts.privacyReads++;
    }
    assert.equal(receipts.acceptedRatings, 9, "Two real employers must store exactly 4+5 ratings");

    // B has reached five valid participants but is still OPEN. No aggregate
    // may be disclosed before the owner explicitly closes the survey.
    assertSurveyRead(await read(b, b.cookie), b, otherEmployers(b),
      { employee: false, status: "open", disclosed: false });
    receipts.privacyReads++;

    for (const actor of [a, b]) {
      const before = await snapshot(actor.org.id);
      const result = await close(actor);
      assert.equal(result.status, 200, actor.label + ": authenticated owner closure required");
      assert.deepEqual(result.json, { id: actor.survey.id, status: "closed" });
      assertNoForeignMarkers(result.text, otherEmployers(actor), "owner survey close");
      const after = await snapshot(actor.org.id);
      assertCloseDelta(before, after, actor);
      baseline.set(actor.org.id, after);
      receipts.closedSurveys++;
      await unchanged(actor.label + " legitimate close");

      const disclosed = actor === b;
      const opts = { employee: false, status: "closed", disclosed,
        responses: disclosed ? 5 : null, average: disclosed ? 3 : null };
      assertSurveyRead(await read(actor, actor.cookie), actor, otherEmployers(actor), opts);
      receipts.privacyReads++;
      assertSurveyRead(await read(actor, actor.employeeSessions[0].cookie),
        actor, otherEmployers(actor),
        { ...opts, employee: true, submitted: true });
      receipts.privacyReads++;
      assertSurveyRead(await read(actor, actor.employeeSessions[5].cookie),
        actor, otherEmployers(actor),
        { ...opts, employee: true, submitted: false });
      receipts.privacyReads++;

      await denied(await close(actor), 409, actor.label + " repeated close denied");
      await denied(await submit(actor, actor.employeeSessions[5], { score: 5 }), 409,
        actor.label + " new response after close denied");
      await denied(await close(actor, {
        organizationId: actor.org.id, surveyId: victim.survey.id,
      }), 409, actor.label + " victim survey cannot be closed under owned employer");
      await denied(await close(actor, {
        organizationId: victim.org.id, surveyId: victim.survey.id,
      }), 403, actor.label + " victim employer cannot be closed");
    }

    // One real employee grant is revoked while the employee remains signed in.
    const revokedEmployee = a.employeeSessions[0];
    const changed = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, revokedEmployee.account.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true))).returning();
    assert.equal(changed.length, 1, "Exactly one employee membership must be revoked");
    baseline.set(a.org.id, await snapshot(a.org.id));
    const authenticatedAfterRevocation = await local("/api/account",
      { cookie: revokedEmployee.cookie });
    assert.equal(authenticatedAfterRevocation.status, 200,
      "Revocation denial cannot be explained by a logged-out employee");
    const revokedPage = await local("/app/engagement?organizationId=" + a.org.id,
      { cookie: revokedEmployee.cookie });
    assert.equal(revokedPage.status, 404, "Revoked employee SSR must deny");
    assertNoForeignMarkers(revokedPage.text, actors, "revoked employee SSR");
    await unchanged("revoked employee SSR unchanged");
    await denied(await read(a, revokedEmployee.cookie), 403,
      "revoked employee GET denied");
    await denied(await submit(a, revokedEmployee, { score: 5 }), 403,
      "revoked employee POST denied");

    await unchanged("final victim and own SQL invariants");
    const victimNow = await snapshot(victim.org.id);
    assert.equal(victimNow.engagementSurveys[0].responseCount, 0);
    assert.equal(victimNow.engagementSurveys[0].scoreSum, 0);
    assert.equal(victimNow.engagementSurveyParticipants.length, 0);
    assert.equal(victimNow.auditEvents.length, 0);
    assert.equal(receipts.foreignPostDenials, 2);
    assert.equal(receipts.sourceIdDenials, 4);
    assert.equal(receipts.duplicateDenials, 2);
    assert.equal(receipts.closedSurveys, 2);
    assert.ok(receipts.privacyReads >= 20, "Every stage needs API privacy assertions");
    const result = {
      kind: "ENGAGEMENT_EMPLOYEE_SYNTHETIC_PG16_HTTP_UNACCEPTED",
      employers: 3, distinctEmployeeSessions: 18,
      acceptedRatings: receipts.acceptedRatings,
      foreignPostDenials: receipts.foreignPostDenials,
      sourceIdDenials: receipts.sourceIdDenials,
      duplicateDenials: receipts.duplicateDenials,
      rejectedCases: receipts.rejectedCases,
      privacyReads: receipts.privacyReads,
      verifiedOpenSurveyPrivacyFloor: 5,
      closedFourSuppressed: true,
      closedFiveDisclosed: true,
      oneAnswerPerLinkedWorker: true,
      unlinkedDenied: true,
      revokedSessionStillAuthenticated: true,
      victimAndPayrollStateUnchanged: true,
      perEmployeeScoresPersisted: false,
      browserHydrationProven: false,
      methodCredits: 0, pageCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    };
    console.log("ENGAGEMENT_EMPLOYEE_HTTP_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("tenant-engagement-employee-http.mjs")) {
  verifyEngagementEmployeePrivacy().catch(error => {
    console.error("ENGAGEMENT_EMPLOYEE_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
