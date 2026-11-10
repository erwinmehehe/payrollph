/**
 * Real HTTP + PostgreSQL 16 Worker 360 boundary proof.
 * Aborts before importing DB/fixture modules unless CI env is disposable.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, API, AS_OF, requireDisposableWorker360Env,
  verifyWorker360SourcePins, assertOwnPage, assertOwnWorkerApi,
  assertDenied, assertNoForeignOrPrivateMarkers, assertUnchangedSql,
} from "./tenant-hcm-worker360-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const pagePath = (org, employee, extra = "") =>
  PAGE + "?organizationId=" + org + "&employeeId=" + employee + extra;
const apiPath = (org, employee, extra = "") =>
  API + "?organizationId=" + org + "&employeeId=" + employee + extra;

async function httpGet(path, cookie) {
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSR/denial is not necessarily JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveWorker360Isolation() {
  requireDisposableWorker360Env();
  verifyWorker360SourcePins();
  const [{ db, pool }, s, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const { and, asc, eq } = orm;
  const sqlTables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "jobProfiles", "positions",
    "positionAssignments", "workerEmploymentEvents", "auditEvents",
    "permissionSets", "userPermissionAssignments",
  ];
  const snapshot = async orgId => {
    const state = {};
    for (const name of sqlTables) {
      const table = s[name];
      assert.ok(table?.id, "Missing protected table ID: " + name);
      const column = name === "organizations" ? table.id : table.organizationId;
      assert.ok(column, "Missing protected employer column: " + name);
      state[name] = plain(await db.select().from(table)
        .where(eq(column, orgId)).orderBy(asc(table.id)));
    }
    return state;
  };
  let ownedPages = 0, ownedApi = 0, deniedCases = 0, foreignDenials = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num"))
      .rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Requires actual PostgreSQL 16");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "Disposable local app_db must start without employers");
    assert.deepEqual(await db.select().from(s.users).limit(1), [],
      "Disposable local app_db must start without users");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = {
        ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)),
        label,
      };
      actor.privateBank = "SECRET-BANK-" + label + "-" + nonce;
      actor.privateTax = "SECRET-TAX-" + label + "-" + nonce;
      actor.privateEventReason = "PRIVATE-EVENT-NOTES-" + label + "-" + nonce;
      await db.update(s.employees).set({
        bankAccount: actor.privateBank, tin: actor.privateTax,
      }).where(eq(s.employees.id, actor.worker.id));
      actor.secondWorker = await fixture.addWorker(actor, "SECOND");
      const [job] = await db.insert(s.jobProfiles).values({
        organizationId: actor.org.id, title: actor.marker + " sample role",
      }).returning();
      const [position] = await db.insert(s.positions).values({
        organizationId: actor.org.id, code: actor.marker + "-POSITION",
        jobProfileId: job.id, orgUnitId: actor.unit.id,
        legalEntityId: actor.entity.id,
      }).returning();
      const [assignment] = await db.insert(s.positionAssignments).values({
        organizationId: actor.org.id, positionId: position.id,
        employeeId: actor.worker.id, assignmentType: "primary",
        effectiveFrom: "2026-01-01",
      }).returning();
      actor.job = job;
      actor.position = position;
      actor.assignment = assignment;
      const event = (effectiveDate, eventType) => ({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        effectiveDate, eventType, positionAssignmentId: assignment.id,
        reason: actor.privateEventReason,
        metadata: { privateNotes: actor.privateEventReason },
      });
      const [earlier] = await db.insert(s.workerEmploymentEvents)
        .values(event("2026-03-01", "hire")).returning();
      const [later] = await db.insert(s.workerEmploymentEvents)
        .values(event("2026-07-12", "assignment")).returning();
      const [future] = await db.insert(s.workerEmploymentEvents)
        .values(event("2027-01-01", "future_event")).returning();
      actor.events = { earlier, later, future };
      employers.push(actor);
    }
    const [a, b, victim] = employers;
    assert.equal(new Set(employers.map(x => x.cookie)).size, 3);
    assert.equal(new Set(employers.map(x => x.org.id)).size, 3);
    for (const key of ["org", "worker", "secondWorker", "position", "assignment"]) {
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id),
        "Genuine higher-ID third-employer required: " + key);
    }
    assert.ok(victim.events.earlier.id > b.events.future.id,
      "Third-employer's actual employment history must have higher IDs");
    const addActor = async (role, unitId, suffix) => {
      const [user] = await db.insert(s.users).values({
        email: "worker360-" + role + "-" + suffix + "-" + nonce + "@example.invalid",
        name: "Fictional Worker360 " + role,
        passwordHash: "fictional-only", role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: a.org.id, role,
        orgUnitId: unitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    };
    const hr = await addActor("hr", null, "company");
    const hrUnit = await addActor("hr", a.unit.id, "unit");
    const manager = await addActor("manager", a.unit.id, "manager");
    const bookkeeper = await addActor("bookkeeper", null, "finance");

    const baselines = new Map();
    for (const actor of employers) {
      baselines.set(actor.org.id, await snapshot(actor.org.id));
    }
    const unchanged = async reason => {
      for (const actor of employers) {
        assertUnchangedSql(baselines.get(actor.org.id),
          await snapshot(actor.org.id), reason + "/" + actor.label);
      }
    };
    const deny = async (path, cookie, status, reason) => {
      const response = await httpGet(path, cookie);
      assertDenied(response, status, employers, reason);
      await unchanged(reason);
      deniedCases++;
      return response;
    };
    const readPage = async (actor, employee, cookie) => {
      const response = await httpGet(pagePath(actor.org.id, employee.id), cookie);
      assertOwnPage(response, actor, employee,
        employers.filter(x => x !== actor));
      await unchanged("owned SSR " + actor.label);
      ownedPages++;
    };
    const readApi = async (actor, employee, cookie, assignment, events,
      extra = "", options = {}) => {
      const response = await httpGet(apiPath(actor.org.id, employee.id, extra), cookie);
      assertOwnWorkerApi(response, actor, employee, assignment, events,
        employers.filter(x => x !== actor), options);
      await unchanged("owned API " + actor.label + extra);
      ownedApi++;
      return response;
    };

    for (const actor of [a, b]) {
      await readPage(actor, actor.worker, actor.cookie);
      await readPage(actor, actor.secondWorker, actor.cookie);
      await readApi(actor, actor.worker, actor.cookie, actor.assignment,
        [actor.events.later, actor.events.earlier],
        "&asOfDate=" + AS_OF);
      // Authorizing the same employer does not justify returning the first
      // worker when a second real employee is explicitly requested.
      await readApi(actor, actor.secondWorker, actor.cookie, null, [],
        "&asOfDate=" + AS_OF);
      await readApi(actor, actor.worker, actor.cookie, actor.assignment,
        [actor.events.earlier], "&asOfDate=2026-06-01",
        { asOfDate: "2026-06-01" });
      await readApi(actor, actor.worker, actor.cookie, actor.assignment,
        [actor.events.earlier],
        "&asOfDate=" + AS_OF + "&beforeDate=2026-07-12&beforeId=" + actor.events.later.id,
        { before: { effectiveDate: "2026-07-12", id: actor.events.later.id } });

      // GET with two query values may honor the first value; no second
      // selector may ever influence the authorized worker or employer.
      await readApi(actor, actor.worker, actor.cookie, actor.assignment,
        [actor.events.later, actor.events.earlier],
        "&asOfDate=" + AS_OF +
        "&organizationId=" + victim.org.id + "&employeeId=" + victim.worker.id);
      await deny(apiPath(actor.org.id, victim.worker.id,
        "&asOfDate=" + AS_OF), actor.cookie, 404,
        actor.label + ": foreign actual employee within own employer selector");
      await deny(apiPath(actor.org.id, b === actor ? a.worker.id : b.worker.id,
        "&asOfDate=" + AS_OF), actor.cookie, 404,
        actor.label + ": other attacker's actual employee ID");
      await deny(apiPath(victim.org.id, victim.worker.id, "&asOfDate=" + AS_OF),
        actor.cookie, 403, actor.label + ": victim employer API");
      await deny(pagePath(victim.org.id, victim.worker.id),
        actor.cookie, 404, actor.label + ": victim employer SSR");
      await deny(pagePath(actor.org.id, victim.worker.id),
        actor.cookie, 404, actor.label + ": foreign worker inside own employer SSR");
      await deny(pagePath(actor.org.id, b === actor ? a.worker.id : b.worker.id),
        actor.cookie, 404, actor.label + ": other attacker's worker inside own employer SSR");
      foreignDenials += 6;
      await deny(pagePath(actor.org.id, victim.worker.id,
        "&employeeId=" + actor.worker.id), actor.cookie, 404,
        actor.label + ": foreign worker first with duplicated own employee selector");
      await deny(pagePath(actor.org.id, actor.worker.id,
        "&organizationId=" + victim.org.id), actor.cookie, 404,
        actor.label + ": duplicate employer selector must fail closed");
      await deny(apiPath(victim.org.id, victim.worker.id,
        "&organizationId=" + actor.org.id + "&asOfDate=" + AS_OF),
        actor.cookie, 403, actor.label + ": victim-first duplicate employer");
      await deny(apiPath(actor.org.id, victim.worker.id,
        "&employeeId=" + actor.worker.id + "&asOfDate=" + AS_OF),
        actor.cookie, 404, actor.label + ": victim-first duplicate worker");
      await deny(apiPath("01", actor.worker.id), actor.cookie, 400,
        actor.label + ": noncanonical employer ID");
      await deny(apiPath(actor.org.id, "01"), actor.cookie, 400,
        actor.label + ": noncanonical employee ID");
      await deny(pagePath(actor.org.id, "01"), actor.cookie, 404,
        actor.label + ": invalid employee SSR selector");
      await deny(apiPath(actor.org.id, actor.worker.id, "&asOfDate=2026-02-30"),
        actor.cookie, 400, actor.label + ": impossible as-of date");
      await deny(apiPath(actor.org.id, actor.worker.id,
        "&asOfDate=" + AS_OF + "&beforeId=" + actor.events.later.id),
        actor.cookie, 400, actor.label + ": missing cursor date");
      await deny(apiPath(actor.org.id, actor.worker.id,
        "&asOfDate=" + AS_OF + "&beforeDate=2027-01-01&beforeId=1"),
        actor.cookie, 400, actor.label + ": future cursor");
      await deny(apiPath(actor.org.id, actor.worker.id, "&asOfDate=" + AS_OF +
        "&beforeDate=2026-07-12&beforeId=0"), actor.cookie, 400,
        actor.label + ": zero event cursor");
    }

    await readPage(a, a.worker, hr.cookie);
    await readApi(a, a.worker, hr.cookie, a.assignment,
      [a.events.later, a.events.earlier], "&asOfDate=" + AS_OF);
    for (const [role, session] of [
      ["bookkeeper", bookkeeper], ["manager", manager], ["unit-scoped HR", hrUnit],
    ]) {
      await deny(pagePath(a.org.id, a.worker.id), session.cookie, 404,
        role + ": restricted SSR");
      await deny(apiPath(a.org.id, a.worker.id, "&asOfDate=" + AS_OF),
        session.cookie, 403, role + ": restricted API");
    }

    const anonymous = await httpGet(pagePath(a.org.id, a.worker.id));
    assert.ok([307, 308].includes(anonymous.status),
      "Anonymous page must redirect to login");
    assert.ok(anonymous.headers.get("location")?.includes("/login"));
    assertNoForeignOrPrivateMarkers(anonymous, employers, null, "anonymous SSR");
    await unchanged("anonymous SSR");
    deniedCases++;
    await deny(apiPath(a.org.id, a.worker.id, "&asOfDate=" + AS_OF),
      undefined, 401, "anonymous API");

    const [disabled] = await db.update(s.userOrganizations)
      .set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(disabled?.userId, a.owner.id,
      "Only fictional fixture's own owner membership is revoked");
    baselines.set(a.org.id, await snapshot(a.org.id));
    await deny(pagePath(a.org.id, a.worker.id), a.cookie, 404,
      "revoked owner SSR");
    await deny(apiPath(a.org.id, a.worker.id, "&asOfDate=" + AS_OF),
      a.cookie, 403, "revoked owner API");
    await unchanged("final readonly database snapshot");
    assert.equal(ownedPages, 5,
      "Two owners must render both actual same-employer employees, plus authorized HR");
    assert.equal(ownedApi, 11);
    assert.equal(foreignDenials, 12,
      "Two owners must each deny two actual foreign employee SSRs and two foreign API/SSR selectors");
    assert.equal(deniedCases, 44, "Every independent page and API negative control must execute");

    console.log(JSON.stringify({
      family: "hcm-worker360-page-and-get", pg16: true,
      legitimateEmployers: 2, higherIdVictim: true,
      realFictionalWorkers: 6, realPositionAssignments: 3,
      realEmploymentEvents: 9, ownedPages, ownedApi,
      foreignDenials, deniedCases, protectedTables: sqlTables.length,
      businessSqlUnchanged: true, pageShellNotDataProof: true,
      serverWorkerBindingEnforced: true, reviewerSignoff: "PENDING",
      enterprisePlanGateProven: false, methodCredits: 0, pageCredits: 0,
      externalProviderCalls: 0, accepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-hcm-worker360-http.mjs")) {
  await proveWorker360Isolation();
}
