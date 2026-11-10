/**
 * Independent Hire-to-Payroll Review SSR tenant/worker real HTTP proof.
 * Only disposable fictional PostgreSQL 16, no tenant coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, requireDisposableHireReviewEnv, verifyHireReviewSourcePins,
  assertOwnedHirePage, assertDeniedHirePage, noPrivateMarkers,
} from "./tenant-hire-payroll-review-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const pathFor = (organizationId, employeeId, extra = "") =>
  PAGE + "?organizationId=" + organizationId + "&employeeId=" + employeeId + extra;

async function readLocal(path, cookie) {
  assert.ok(path === "/api/account" || path.startsWith(PAGE + "?"),
    "HIRE_REVIEW_REFUSED: only reviewed local paths may be requested");
  const response = await fetch(ORIGIN + path, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if (path === "/api/account") {
    try { json = JSON.parse(text); } catch { /* The explicit check rejects this. */ }
  }
  return { status: response.status, text, headers: response.headers, json };
}

export async function proveHirePayrollReviewIsolation() {
  // Both checks MUST precede imports of DB, fixture, and application modules.
  requireDisposableHireReviewEnv();
  verifyHireReviewSourcePins();

  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const tables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "provisioningTasks",
    "payrollRuns", "auditEvents", "permissionSets", "userPermissionAssignments",
  ];
  async function snapshot(orgId) {
    const state = {};
    for (const name of tables) {
      const table = s[name];
      assert.ok(table?.id, "HIRE_REVIEW: missing protected table " + name);
      const tenantColumn = name === "organizations" ? table.id : table.organizationId;
      assert.ok(tenantColumn, "HIRE_REVIEW: unscoped protected table " + name);
      state[name] = plain(await db.select().from(table)
        .where(eq(tenantColumn, orgId)).orderBy(asc(table.id)));
    }
    return state;
  }
  try {
    const version = Number((await pool.query("SHOW server_version_num"))
      .rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "Actual PostgreSQL 16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "Only an initially empty fictional employer database is permitted");
    assert.deepEqual(await db.select().from(s.users).limit(1), [],
      "Only an initially empty fictional user database is permitted");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession)), label: "A" };
    const b = { ...(await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession)), label: "B" };
    const victim = { ...(await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession)), label: "Victim" };
    const employers = [a, b, victim];
    for (const subject of employers) {
      subject.secondWorker = await fixture.addWorker(subject, "SECOND");
      subject.privateTax = "HIRE-REVIEW-PRIVATE-TAX-" + subject.label + "-" + nonce;
      subject.privateBank = "HIRE-REVIEW-PRIVATE-BANK-" + subject.label + "-" + nonce;
      await db.update(s.employees).set({
        tin: subject.privateTax, bankAccount: subject.privateBank,
      }).where(eq(s.employees.id, subject.worker.id));
    }
    assert.equal(new Set(employers.map(s => s.cookie)).size, 3);
    assert.equal(new Set(employers.map(s => s.org.id)).size, 3);
    for (const field of ["org", "entity", "unit", "worker", "secondWorker", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "HIRE_REVIEW: genuine higher-ID victim required for " + field);
    }

    async function addRole(role, orgUnitId, label) {
      const [user] = await db.insert(s.users).values({
        email: "hire-review-" + label + "-" + nonce + "@example.invalid",
        name: "Fictional hire review " + label,
        passwordHash: "fictional-only", role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: a.org.id,
        role, orgUnitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const hr = await addRole("hr", null, "hr-company");
    const unitHr = await addRole("hr", a.unit.id, "hr-unit");
    const manager = await addRole("manager", a.unit.id, "manager");
    const bookkeeper = await addRole("bookkeeper", null, "bookkeeper");

    const before = new Map();
    for (const subject of employers) before.set(subject.org.id, await snapshot(subject.org.id));
    async function unchanged(label) {
      for (const subject of employers) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          label + ": GET changed protected employer/employee/payroll/provisioning/audit SQL");
      }
    }
    let ownPositives = 0, denials = 0, foreignDenials = 0;
    async function own(actor, worker, cookie = actor.cookie) {
      const response = await readLocal(pathFor(actor.org.id, worker.id), cookie);
      assertOwnedHirePage(response, actor, worker, employers);
      await unchanged("own " + actor.label + " worker " + worker.id);
      ownPositives++;
    }
    async function deny(path, cookie, label) {
      const response = await readLocal(path, cookie);
      assertDeniedHirePage(response, employers, label);
      await unchanged(label);
      denials++;
      return response;
    }
    for (const actor of [a, b]) {
      const auth = await readLocal("/api/account", actor.cookie);
      assert.equal(auth.status, 200, "HIRE_REVIEW: actual signed-in HTTP owner session required");
      assert.equal(auth.json?.profile?.id, actor.owner.id);
      await own(actor, actor.worker);
      await own(actor, actor.secondWorker);
      for (const outsider of employers.filter(subject => subject !== actor)) {
        await deny(pathFor(actor.org.id, outsider.worker.id), actor.cookie,
          actor.label + ": foreign real worker under authorized employer");
        await deny(pathFor(outsider.org.id, outsider.worker.id), actor.cookie,
          actor.label + ": foreign employer and worker");
        foreignDenials += 2;
      }
      await deny(pathFor(actor.org.id, 99999999), actor.cookie,
        actor.label + ": nonexistent worker ID");
      for (const invalid of ["0", "01", "-1", "1.0", "1e0", "9007199254740992", "x"]) {
        await deny(pathFor(actor.org.id, invalid), actor.cookie,
          actor.label + ": invalid employee ID " + invalid);
      }
      for (const invalid of ["0", "01", "-1", "1.0", "1e0", "9007199254740992", "x"]) {
        await deny(pathFor(invalid, actor.worker.id), actor.cookie,
          actor.label + ": invalid employer ID " + invalid);
      }
      await deny(pathFor(actor.org.id, actor.worker.id,
        "&employeeId=" + victim.worker.id), actor.cookie,
        actor.label + ": duplicated worker selector");
      await deny(pathFor(actor.org.id, actor.worker.id,
        "&organizationId=" + victim.org.id), actor.cookie,
        actor.label + ": duplicated employer selector");
      await deny(pathFor(actor.org.id, victim.worker.id,
        "&employeeId=" + actor.worker.id), actor.cookie,
        actor.label + ": foreign-first duplicate worker selector");
      await deny(pathFor(victim.org.id, actor.worker.id,
        "&organizationId=" + actor.org.id), actor.cookie,
        actor.label + ": foreign-first duplicate employer selector");
    }

    await own(a, a.worker, hr.cookie);
    for (const [label, actor] of [
      ["unit HR", unitHr], ["manager", manager], ["bookkeeper", bookkeeper],
    ]) await deny(pathFor(a.org.id, a.worker.id), actor.cookie, label + " role/scope");

    const anonymous = await readLocal(pathFor(a.org.id, a.worker.id));
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "HIRE_REVIEW: anonymous page must redirect to login");
    assert.ok(anonymous.headers.get("location")?.includes("/login"),
      "HIRE_REVIEW: anonymous redirect must target login");
    noPrivateMarkers(anonymous.text, employers, "anonymous");
    await unchanged("anonymous request");
    denials++;

    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true)))
      .returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1);
    const stillSignedIn = await readLocal("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200);
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    before.set(a.org.id, await snapshot(a.org.id));
    await deny(pathFor(a.org.id, a.worker.id), a.cookie,
      "revoked membership with still-valid session");

    await unchanged("final immutable SQL snapshots");
    assert.equal(ownPositives, 5);
    assert.equal(foreignDenials, 8);
    assert.ok(denials >= 49, "HIRE_REVIEW: real denials must be executed");

    // Disposable, explicit fault injection after all row-immutability checks.
    // The lookup is already bound to an owned worker before the loader fails.
    await pool.query("ALTER TABLE provisioning_tasks RENAME TO qa_hire_review_source_unavailable");
    const unavailable = await readLocal(pathFor(b.org.id, b.worker.id), b.cookie);
    assert.equal(unavailable.status, 200, "Bound own worker may render source-unavailable shell");
    assert.ok(unavailable.text.includes("input sources are temporarily unavailable"),
      "Only a verified employer/employee pair can render bounded source failure");
    assert.ok(!unavailable.text.includes("Recorded source evidence"),
      "A source outage must not display stale positive evidence");
    noPrivateMarkers(unavailable.text, employers, "bounded source unavailable");
    await pool.query("ALTER TABLE employees RENAME TO qa_hire_review_workers_unavailable");
    const gateError = await readLocal(pathFor(b.org.id, b.worker.id), b.cookie);
    assert.ok([500, 503].includes(gateError.status),
      "Failed employee existence query must fail closed, not render 200");
    assert.ok(!gateError.text.includes("Hire-to-payroll input evidence"),
      "Failed employee existence lookup cannot mount worker-specific UI");
    noPrivateMarkers(gateError.text, employers, "employee gate failure");

    const summary = {
      family: "hcm-hire-payroll-review-ssr", employers: 3,
      independentOwners: 2, ownPositives, foreignDenials, denials,
      immutableEmployerTables: tables.length, workerScoped: true,
      genuineHigherIdVictim: true, sourceOutageBounded: true,
      gateErrorFailsClosed: true, pageActionCredits: 0,
      apiMethodCredits: 0, independentlyAccepted: false, productionCertified: false,
    };
    console.log("TENANT_HIRE_REVIEW_PG16_COMPLETE " + JSON.stringify(summary));
    return summary;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-hire-payroll-review-http.mjs")) {
  proveHirePayrollReviewIsolation().catch(error => {
    console.error("TENANT_HIRE_REVIEW_PG16_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
