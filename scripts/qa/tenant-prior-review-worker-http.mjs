/**
 * Prior-employer worker-context SSR: fictional PG16 only, two attackers and
 * higher-ID victim, plus same-tenant foreign legal-employer worker.
 * GET-only and source-pinned; it never awards a tenant coverage credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, requireDisposablePriorWorkerEnv, verifyPriorWorkerSource,
  assertPriorOwnPage, assertPriorDeniedPage, noForeignPriorMarkers,
} from "./tenant-prior-review-worker-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const pathFor = (orgId, employeeId) =>
  PAGE + "?organizationId=" + orgId + (employeeId === undefined ? "" : "&employeeId=" + employeeId);

async function getLocal(path, cookie) {
  assert.ok(path === "/api/account" || path === PAGE || path.startsWith(PAGE + "?"),
    "PRIOR_WORKER_REFUSED: no unreviewed paths");
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {}, redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if (path === "/api/account") {
    try { json = JSON.parse(text); } catch { /* Explicit check rejects invalid account. */ }
  }
  return { status: response.status, text, headers: response.headers, json };
}

export async function provePriorWorkerBoundary() {
  requireDisposablePriorWorkerEnv();
  verifyPriorWorkerSource(); // Both hard refusals must happen before any DB import.

  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const tables = [
    "organizations", "legalEntities", "employees", "userLegalEntityGrants",
    "payrollRuns", "yearEndPriorEvidence", "auditEvents",
  ];
  async function snapshot(orgId) {
    const state = {};
    for (const name of tables) {
      const table = s[name];
      assert.ok(table?.id, "Missing SQL table: " + name);
      const idColumn = name === "organizations" ? table.id : table.organizationId;
      state[name] = plain(await db.select().from(table)
        .where(eq(idColumn, orgId)).orderBy(asc(table.id)));
    }
    return state;
  }
  try {
    const pg16 = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg16 >= 160000 && pg16 < 170000, "Actual disposable PG16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "No preexisting organizations allowed");
    assert.deepEqual(await db.select().from(s.users).limit(1), [],
      "No preexisting users allowed");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession)), label: "A" };
    const b = { ...(await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession)), label: "B" };
    for (const subject of [a, b]) {
      await db.insert(s.userLegalEntityGrants).values({
        userId: subject.owner.id, organizationId: subject.org.id,
        legalEntityId: subject.entity.id,
      });
      subject.secondWorker = await fixture.addWorker(subject, "SECOND");
    }

    // A second legal employer exists inside A's tenant, but A's operator
    // has only the primary legal-employer grant. Its real worker must 404.
    const [otherEntity] = await db.insert(s.legalEntities).values({
      organizationId: a.org.id, code: "FOREIGN-" + nonce,
      legalName: "Ungrantable fictional employer " + nonce,
      displayName: "Restricted employer", primaryEntity: false,
    }).returning();
    const [otherUnit] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: otherEntity.id,
      type: "department", code: "RESTRICTED-" + nonce, name: "Restricted unit",
    }).returning();
    const [otherWorker] = await db.insert(s.employees).values({
      organizationId: a.org.id, legalEntityId: otherEntity.id, orgUnitId: otherUnit.id,
      employeeNo: "RESTRICTED-" + nonce, firstName: "Restricted",
      lastName: "Fictional", title: "Fictional", avatarInitials: "RF",
      basicRate: "20000.00", startDate: "2026-01-05",
    }).returning();

    // Victim is last: all its organization/entity/unit/worker/user IDs exceed
    // attacker-owned seeds, avoiding trivial "low ID" false positives.
    const victim = { ...(await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession)), label: "victim" };
    await db.insert(s.userLegalEntityGrants).values({
      userId: victim.owner.id, organizationId: victim.org.id,
      legalEntityId: victim.entity.id,
    });
    const subjects = [a, b, victim];
    for (const actor of [a, b]) for (const key of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[key].id > actor[key].id, "Real higher-ID victim " + key + " required");
    }
    assert.ok(victim.worker.id > otherWorker.id);

    const [scopedUser] = await db.insert(s.users).values({
      email: "prior-scoped-" + nonce + "@example.invalid",
      name: "Fictional scoped payroll", passwordHash: "fictional-only",
      role: "bookkeeper", totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: scopedUser.id, organizationId: a.org.id,
      role: "bookkeeper", orgUnitId: a.unit.id, active: true,
    });
    const scopedSession = await fixture.standaloneMakeSession(scopedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, scopedSession.id));

    const before = new Map(await Promise.all(subjects.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));
    async function unchanged(label) {
      for (const subject of subjects)
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          label + ": private employer/tax/payroll/audit SQL must be unchanged");
    }
    let ownPositives = 0, crossTenantDenials = 0, deniedCases = 0;
    async function deny(path, cookie, label) {
      const result = await getLocal(path, cookie);
      assertPriorDeniedPage(result, subjects, label);
      deniedCases++;
      await unchanged(label);
      return result;
    }
    for (const actor of [a, b]) {
      const account = await getLocal("/api/account", actor.cookie);
      assert.equal(account.status, 200, "Real session API positive required");
      assert.equal(account.json?.profile?.id, actor.owner.id);
      for (const worker of [actor.worker, actor.secondWorker]) {
        const own = await getLocal(pathFor(actor.org.id, worker.id), actor.cookie);
        assertPriorOwnPage(own, actor, worker, subjects);
        ownPositives++;
        await unchanged("own worker");
      }
      const unselected = await getLocal(pathFor(actor.org.id), actor.cookie);
      assert.equal(unselected.status, 200, "Unselected worker must permit authorized guidance");
      assert.ok(unselected.text.includes('data-organization-id="' + actor.org.id + '"'));
      noForeignPriorMarkers(unselected.text, subjects.filter(s => s !== actor), "unselected");
      await unchanged("unselected");
      for (const other of subjects.filter(s => s !== actor)) {
        await deny(pathFor(actor.org.id, other.worker.id), actor.cookie,
          "foreign worker under own employer");
        await deny(pathFor(other.org.id, other.worker.id), actor.cookie,
          "foreign employer and worker");
        crossTenantDenials += 2;
      }
      await deny(pathFor(actor.org.id, 99999999), actor.cookie, "nonexistent worker");
      for (const invalid of ["0", "01", "-1", "+1", "1e0", "1.0",
        "9007199254740992", "%201", "x", actor.worker.id + "&employeeId=" + victim.worker.id]) {
        await deny(pathFor(actor.org.id, invalid), actor.cookie,
          "invalid or duplicated worker selector " + invalid);
      }
      await deny(pathFor(actor.org.id, actor.worker.id) +
        "&organizationId=" + victim.org.id, actor.cookie, "duplicate employer selector");
    }
    assert.equal(ownPositives, 4);
    assert.equal(crossTenantDenials, 8);
    await deny(pathFor(a.org.id, otherWorker.id), a.cookie,
      "same-tenant worker from ungranted legal employer");
    await deny(pathFor(a.org.id, a.worker.id), scopedSession.cookie,
      "unit-scoped bookkeeper cannot mount payroll tax review");
    const anonymous = await getLocal(pathFor(a.org.id, a.worker.id));
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "Anonymous must redirect to login");
    assert.ok(anonymous.headers.get("location")?.includes("/login"),
      "Anonymous redirect must target login");
    noForeignPriorMarkers(anonymous.text, subjects, "anonymous");
    await unchanged("anonymous");

    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.userId, a.owner.id), eq(s.userOrganizations.active, true)))
      .returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1);
    const stillAuthenticated = await getLocal("/api/account", a.cookie);
    assert.equal(stillAuthenticated.status, 200);
    assert.equal(stillAuthenticated.json?.profile?.id, a.owner.id);
    await deny(pathFor(a.org.id, a.worker.id), a.cookie,
      "revoked active membership with valid session");
    await unchanged("final tenant SQL snapshots");

    assert.ok(deniedCases >= 32, "All independent denial paths must execute");
    // Explicit fault injection: an unavailable employee lookup is NOT a
    // legitimate worker and may not render a prior-employer private shell.
    await pool.query("ALTER TABLE employees RENAME TO qa_prior_worker_query_unavailable");
    const fault = await getLocal(pathFor(b.org.id, b.worker.id), b.cookie);
    assert.ok([500, 503].includes(fault.status),
      "Missing employee source must fail closed instead of mounting a 200");
    assert.ok(!fault.text.includes('data-organization-id="'),
      "Source outage cannot mount the employer/worker review form");
    noForeignPriorMarkers(fault.text, subjects, "bound worker source failure");

    const result = {
      family: "prior-employer-worker-ssr", employers: 3, independentOwners: 2,
      ownPositives, crossTenantDenials, deniedCases,
      sameTenantDifferentLegalEmployerDenied: true, revokedSessionDenied: true,
      immutableEmployerTables: tables.length, sourceOutageFailsClosed: true,
      pageActionCredits: 0, apiMethodCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    };
    console.log("TENANT_PRIOR_WORKER_PG16_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-prior-review-worker-http.mjs")) {
  provePriorWorkerBoundary().catch(error => {
    console.error("TENANT_PRIOR_WORKER_PG16_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
