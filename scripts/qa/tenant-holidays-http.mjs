/**
 * Provisional 4-GAP Holiday Calendar tenant proof (zero coverage credits).
 * Executes ONLY on a new, empty fictional PostgreSQL 16 + localhost Next server.
 * No real payroll, customer holidays, bank, provider or statutory filing action.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertHolidayList, assertHolidayDenial, assertHolidayUnchanged, assertHolidayTransition,
} from "./tenant-holidays-contract.mjs";

const PATH = "/api/holidays";
const BASE_DATE = "2040-06-15";
const UPDATED_DATE = "2040-06-16";
const BUSY_DATE = "2040-08-15";

function requireDisposable(env = process.env) {
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_HOLIDAYS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    MULTI_ENTITY_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
  })) {
    assert.equal(env[key], value, "HOLIDAYS_TENANT_REFUSED: " + key);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "MAILGUN_API_KEY", "SMTP_URL"]) {
    assert.ok(!env[key], "HOLIDAYS_TENANT_REFUSED: no provider credentials " + key);
  }
}

async function getOwn(request, actor, orgId = actor.org.id) {
  return request(PATH + "?organizationId=" + orgId, { cookie: actor.ownerCookie });
}

async function seedHolidayFixture(db, s, employer, makeSession) {
  const [unitPeer] = await db.insert(s.orgUnits).values({
    organizationId: employer.org.id, legalEntityId: employer.entity.id,
    type: "department", code: "HOL-PEER-" + employer.label,
    name: employer.marker + " separately restricted department",
  }).returning();
  const [site, peerSite] = await db.insert(s.worksites).values([
    { organizationId: employer.org.id, orgUnitId: employer.unit.id,
      code: "HOL-OWN-" + employer.label, name: employer.marker + " local worksite" },
    { organizationId: employer.org.id, orgUnitId: unitPeer.id,
      code: "HOL-PEER-" + employer.label, name: employer.marker + " peer worksite" },
  ]).returning();
  const [hr] = await db.insert(s.users).values({
    name: employer.marker + " scoped HR",
    email: "holiday-hr-" + randomUUID() + "@example.invalid",
    role: "hr", passwordHash: "fictional-session-only",
  }).returning();
  await db.insert(s.userOrganizations).values({
    userId: hr.id, organizationId: employer.org.id, role: "hr",
    orgUnitId: employer.unit.id, active: true,
  });
  const hrCookie = (await makeSession(hr.id)).cookie;

  const [releasedRun, busyRun] = await db.insert(s.payrollRuns).values([
    {
      organizationId: employer.org.id, legalEntityId: employer.entity.id,
      periodLabel: "Fictional released holiday period " + employer.marker,
      periodStart: "2040-06-01", periodEnd: "2040-06-30",
      payDate: "2040-07-01", status: "Released",
      employeeCount: 1, grossPay: "1000", netPay: "900",
    },
    {
      organizationId: employer.org.id, legalEntityId: employer.entity.id,
      periodLabel: "Fictional payroll-busy holiday period " + employer.marker,
      periodStart: "2040-08-01", periodEnd: "2040-08-31",
      payDate: "2040-09-01", status: "Queued",
      employeeCount: 1, grossPay: "1500", netPay: "1300",
    },
  ]).returning();
  await db.insert(s.payrollEntries).values({
    payrollRunId: releasedRun.id, employeeId: employer.worker.id,
    grossPay: "1000", deductions: "100", netPay: "900",
  });
  const [wide, local, peer, busy] = await db.insert(s.holidays).values([
    { organizationId: employer.org.id, holidayDate: "2040-06-05",
      name: employer.marker + " company-wide holiday", kind: "regular" },
    { organizationId: employer.org.id, orgUnitId: employer.unit.id,
      worksiteId: site.id, holidayDate: "2040-06-08",
      name: employer.marker + " own unit holiday", kind: "special" },
    { organizationId: employer.org.id, orgUnitId: unitPeer.id,
      worksiteId: peerSite.id, holidayDate: "2040-06-09",
      name: employer.marker + " peer-restricted holiday", kind: "special" },
    { organizationId: employer.org.id, orgUnitId: unitPeer.id,
      worksiteId: peerSite.id, holidayDate: BUSY_DATE,
      name: employer.marker + " busy-period holiday", kind: "regular" },
  ]).returning();
  return {
    ...employer, ownerCookie: employer.cookie, hrCookie,
    site, peerSite, unitPeer, hr, releasedRun, busyRun,
    wide, local, peer, busy,
  };
}

async function makeSnapshots(db, s, actors, national) {
  const { and, eq, asc } = await import("drizzle-orm");
  const inOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshotOne = async (actor) => {
    const orgId = actor.org.id;
    const [organization, employees, memberships, units, worksites, holidays, payrollRuns,
      payrollEntries, approvalTasks, audit] = await Promise.all([
      db.select().from(s.organizations).where(eq(s.organizations.id, orgId)),
      inOrg(s.employees, orgId),
      inOrg(s.userOrganizations, orgId),
      inOrg(s.orgUnits, orgId),
      inOrg(s.worksites, orgId),
      inOrg(s.holidays, orgId),
      inOrg(s.payrollRuns, orgId),
      db.select().from(s.payrollEntries)
        .innerJoin(s.payrollRuns, eq(s.payrollEntries.payrollRunId, s.payrollRuns.id))
        .where(eq(s.payrollRuns.organizationId, orgId)).orderBy(asc(s.payrollEntries.id)),
      inOrg(s.approvalTasks, orgId),
      inOrg(s.auditEvents, orgId),
    ]);
    return {
      organization, employees, memberships, units, worksites, holidays, payrollRuns,
      payrollEntries, approvalTasks,
      audit: audit.map(row => Object.fromEntries(Object.entries(row)
        .filter(([key]) => !["chainSeq", "prevHash", "rowHash"].includes(key)))),
    };
  };
  return {
    actors: await Promise.all(actors.map(snapshotOne)),
    national: await db.select().from(s.holidays)
      .where(eq(s.holidays.id, national.id)),
  };
}

function assertOutsideUnchanged(before, after, changedIndex, label) {
  assert.deepEqual(after.national, before.national,
    label + ": the system/national holiday must never be changed");
  for (let i = 0; i < before.actors.length; i++) {
    if (i === changedIndex) continue;
    assertHolidayUnchanged(before.actors[i], after.actors[i],
      label + ": other employer " + i);
  }
}

async function deniedProbe(request, db, s, actors, national, requestArgs, expected,
  victimMarker, label) {
  const before = await makeSnapshots(db, s, actors, national);
  const response = await request(requestArgs.path, {
    method: requestArgs.method, cookie: requestArgs.cookie,
    body: requestArgs.body,
  });
  assertHolidayDenial(response, expected, [victimMarker]);
  const after = await makeSnapshots(db, s, actors, national);
  assert.deepEqual(after, before,
    label + ": foreign, invalid or unauthorized request mutated protected DB rows");
  return response;
}

async function assertActorReads(request, db, s, actors, national, actor) {
  const before = await makeSnapshots(db, s, actors, national);
  const orgId = actor.org.id;
  const otherIds = actors.filter(e => e.org.id !== orgId)
    .flatMap(e => [e.wide.id, e.local.id, e.peer.id, e.busy.id]);
  const otherMarkers = actors.filter(e => e.org.id !== orgId).map(e => e.marker);
  const ownerResponse = await getOwn(request, actor);
  assertHolidayList(ownerResponse, {
    organizationId: orgId, rows: before.actors[actors.indexOf(actor)].holidays,
    forbiddenIds: [...otherIds, national.id],
    forbiddenMarkers: otherMarkers,
  });
  const scoped = await request(PATH + "?organizationId=" + orgId, {
    cookie: actor.hrCookie,
  });
  assertHolidayList(scoped, {
    organizationId: orgId, rows: [actor.wide, actor.local],
    forbiddenIds: [actor.peer.id, actor.busy.id, ...otherIds],
    forbiddenMarkers: [
      actor.peer.name, actor.busy.name, ...otherMarkers,
    ],
  });
  const after = await makeSnapshots(db, s, actors, national);
  assert.deepEqual(after, before, "GET must not mutate holidays, audits, payroll or other employers");
  return ownerResponse;
}

async function exerciseOwnCycle(request, db, s, actors, national, index) {
  const actor = actors[index], organizationId = actor.org.id;
  const body = {
    organizationId, holidayDate: BASE_DATE,
    name: actor.marker + " own new public holiday", kind: "special",
    orgUnitId: actor.unit.id, worksiteId: actor.site.id,
  };
  const snapshot = () => makeSnapshots(db, s, actors, national);
  const beforePost = await snapshot();
  const post = await request(PATH, { method: "POST", cookie: actor.ownerCookie, body });
  const holidayId = post.json?.id;
  assert.ok(Number.isSafeInteger(holidayId) && holidayId > 0,
    "successful own POST must return real persisted holiday ID");
  const afterPost = await snapshot();
  assertHolidayTransition(beforePost.actors[index], afterPost.actors[index], post, {
    action: "create", organizationId, ownerName: actor.owner.name,
    holidayId, holidayDate: BASE_DATE, name: body.name,
    kind: "special", orgUnitId: actor.unit.id, worksiteId: actor.site.id,
    releasedRunId: actor.releasedRun.id,
  });
  assertOutsideUnchanged(beforePost, afterPost, index, actor.label + " create");

  const afterCreatedRead = await getOwn(request, actor);
  assertHolidayList(afterCreatedRead, {
    organizationId, rows: afterPost.actors[index].holidays,
    forbiddenIds: actors.filter(e => e.org.id !== organizationId).map(e => e.local.id),
    forbiddenMarkers: actors.filter(e => e.org.id !== organizationId).map(e => e.marker),
  });

  const updatedName = actor.marker + " updated local holiday";
  const beforePatch = await snapshot();
  const patch = await request(PATH, {
    method: "PATCH", cookie: actor.ownerCookie,
    body: { id: holidayId, name: updatedName, holidayDate: UPDATED_DATE, kind: "regular" },
  });
  const afterPatch = await snapshot();
  assertHolidayTransition(beforePatch.actors[index], afterPatch.actors[index], patch, {
    action: "update", organizationId, ownerName: actor.owner.name,
    holidayId, holidayDate: UPDATED_DATE, name: updatedName,
    kind: "regular", orgUnitId: actor.unit.id, worksiteId: actor.site.id,
    releasedRunId: actor.releasedRun.id,
  });
  assertOutsideUnchanged(beforePatch, afterPatch, index, actor.label + " update");

  const beforeDelete = await snapshot();
  const deleted = await request(PATH + "?id=" + holidayId, {
    method: "DELETE", cookie: actor.ownerCookie,
  });
  const afterDelete = await snapshot();
  assertHolidayTransition(beforeDelete.actors[index], afterDelete.actors[index], deleted, {
    action: "delete", organizationId, ownerName: actor.owner.name,
    holidayId, holidayDate: UPDATED_DATE, name: updatedName,
    releasedRunId: actor.releasedRun.id,
  });
  assertOutsideUnchanged(beforeDelete, afterDelete, index, actor.label + " delete");

  const noLongerThere = await getOwn(request, actor);
  assertHolidayList(noLongerThere, {
    organizationId, rows: afterDelete.actors[index].holidays,
    forbiddenIds: [holidayId],
    forbiddenMarkers: actors.filter(e => e.org.id !== organizationId).map(e => e.marker),
  });
  return holidayId;
}

export async function verifyHolidayCalendarTenantIsolation() {
  // Guard before import of any application/database code and before any network/SQL operation.
  requireDisposable();
  const [{ db, pool }, s, http] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const { rows: [proof] } = await pool.query(
      "select current_setting('server_version_num')::int as version, " +
      "(select count(*)::int from organizations) as orgs, " +
      "(select count(*)::int from users) as users, " +
      "(select count(*)::int from holidays) as holiday_rows");
    assert.equal(Math.floor(proof.version / 10000), 16, "only PG16 accepted");
    assert.deepEqual({ orgs: proof.orgs, users: proof.users, holidays: proof.holiday_rows },
      { orgs: 0, users: 0, holidays: 0 },
      "must start from an empty disposable employer/user/holiday database");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const [national] = await db.insert(s.holidays).values({
      organizationId: null, holidayDate: "2040-06-12",
      name: "Fictional national system holiday " + nonce, kind: "regular",
    }).returning();
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const seed = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      actors.push(await seedHolidayFixture(db, s, seed, http.standaloneMakeSession));
    }
    const victim = actors[2];
    for (const attacker of actors.slice(0, 2)) {
      for (const key of ["org", "worker", "unit"]) {
        const val = key === "worker" ? "worker" : key;
        assert.ok(victim[val].id > attacker[val].id,
          "real higher-ID victim employer/employee/unit is required");
      }
      for (const key of ["site", "wide", "local", "peer", "busy", "releasedRun"]) {
        assert.ok(victim[key].id > attacker[key].id,
          "real victim record " + key + " must exceed both independent attackers");
      }
    }

    const request = http.standaloneRequest;
    await assertActorReads(request, db, s, actors, national, victim);
    await exerciseOwnCycle(request, db, s, actors, national, 2);
    const baselineVictim = (await makeSnapshots(db, s, actors, national)).actors[2];

    const unauth = await request(PATH + "?organizationId=" + victim.org.id);
    assertHolidayDenial(unauth, 401, [victim.marker]);
    for (const [i, actor] of actors.slice(0, 2).entries()) {
      await assertActorReads(request, db, s, actors, national, actor);
      const forbidden = victim.marker;
      const ownOrgId = actor.org.id;
      const foreignId = victim.local.id;
      const badPost = (extra) => ({
        organizationId: ownOrgId, holidayDate: BASE_DATE, kind: "special",
        name: actor.marker + " must be rejected", ...extra,
      });
      const probes = [
        { path: PATH + "?organizationId=" + victim.org.id,
          cookie: actor.ownerCookie, status: 403, label: "cross-org owner GET" },
        { path: PATH + "?organizationId=" + victim.org.id,
          cookie: actor.hrCookie, status: 403, label: "cross-org HR GET" },
        { path: PATH, method: "POST", cookie: actor.ownerCookie,
          body: badPost({ organizationId: victim.org.id }),
          status: 403, label: "cross-org POST" },
        { path: PATH, method: "POST", cookie: actor.ownerCookie,
          body: badPost({ orgUnitId: victim.unit.id }),
          status: 422, label: "stolen victim unit in own-tenant POST" },
        { path: PATH, method: "POST", cookie: actor.ownerCookie,
          body: badPost({ worksiteId: victim.site.id }),
          status: 422, label: "stolen victim worksite in own-tenant POST" },
        { path: PATH, method: "PATCH", cookie: actor.ownerCookie,
          body: { id: foreignId, name: "forged " + actor.marker },
          status: 403, label: "cross-org PATCH by genuine victim row ID" },
        { path: PATH, method: "PATCH", cookie: actor.ownerCookie,
          body: { id: actor.local.id, orgUnitId: victim.unit.id },
          status: 422, label: "stolen unit in own-tenant PATCH" },
        { path: PATH, method: "PATCH", cookie: actor.ownerCookie,
          body: { id: actor.local.id, worksiteId: victim.site.id },
          status: 422, label: "stolen worksite in own-tenant PATCH" },
        { path: PATH + "?id=" + foreignId, method: "DELETE",
          cookie: actor.ownerCookie, status: 403, label: "cross-org DELETE by real ID" },
        { path: PATH, method: "POST", cookie: actor.hrCookie,
          body: badPost({}), status: 403, label: "scoped HR POST denied" },
        { path: PATH, method: "PATCH", cookie: actor.hrCookie,
          body: { id: actor.local.id, name: "forged scoped HR" },
          status: 403, label: "scoped HR PATCH denied" },
        { path: PATH + "?id=" + actor.local.id, method: "DELETE",
          cookie: actor.hrCookie, status: 403, label: "scoped HR DELETE denied" },
        { path: PATH + "?id=" + national.id, method: "DELETE",
          cookie: actor.ownerCookie, status: 409, label: "system holiday DELETE denied" },
        { path: PATH, method: "PATCH", cookie: actor.ownerCookie,
          body: { id: national.id, name: "national forged" },
          status: 409, label: "system holiday PATCH denied" },
        { path: PATH, method: "POST", cookie: actor.ownerCookie,
          body: badPost({ holidayDate: BUSY_DATE }),
          status: 409, label: "busy payroll POST denied" },
        { path: PATH, method: "PATCH", cookie: actor.ownerCookie,
          body: { id: actor.local.id, holidayDate: BUSY_DATE },
          status: 409, label: "busy payroll PATCH denied" },
        { path: PATH + "?id=" + actor.busy.id, method: "DELETE",
          cookie: actor.ownerCookie, status: 409, label: "busy payroll DELETE denied" },
      ];
      for (const probe of probes) {
        await deniedProbe(request, db, s, actors, national, probe,
          probe.status, forbidden, actor.label + ": " + probe.label);
      }
      const ownCreatedId = await exerciseOwnCycle(request, db, s, actors, national, i);
      assert.ok(Number.isSafeInteger(ownCreatedId) && ownCreatedId > actor.busy.id,
        "own positive must create a new persisted holiday after fixture rows");
      const after = await makeSnapshots(db, s, actors, national);
      assertHolidayUnchanged(baselineVictim, after.actors[2],
        actor.label + ": independent attacker operations must never change victim DB");
    }
    const final = await makeSnapshots(db, s, actors, national);
    for (const actor of actors) {
      const own = final.actors[actors.indexOf(actor)];
      assert.deepEqual(own.holidays.map(r => r.id),
        [actor.wide.id, actor.local.id, actor.peer.id, actor.busy.id],
        "create/PATCH/DELETE cycle must leave only the four seeded fictional rows");
      assert.equal(own.payrollRuns[0].status, "Released");
      assert.equal(own.payrollRuns[1].status, "Queued");
      assert.equal(own.payrollEntries.length, 1,
        "fictional released payroll entry must never be recalculated or deleted");
    }
    console.log(JSON.stringify({
      kind: "tenant-holiday-calendar-pg16-http", methods: ["GET", "POST", "PATCH", "DELETE"],
      employers: 3, independentAttackers: 2, higherIdVictim: true,
      realSavedHolidaysAndAudits: true, wrongEmployerAndScopeDenied: true,
      releasedPayrollUntouched: true, payrollBusyBlocked: true,
      zeroMethodCredits: true, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-holidays-http.mjs")) {
  verifyHolidayCalendarTenantIsolation().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
