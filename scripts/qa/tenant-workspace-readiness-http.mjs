/** Independent localhost real-HTTP + disposable PG16 readiness proof. No method credits. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, API_PATH, requireDisposableWorkspaceReadiness,
  verifyReadinessSources, assertOwnedReadiness,
} from "./tenant-workspace-readiness-contract.mjs";

const copy = value => JSON.parse(JSON.stringify(value));
async function httpGet(path, cookie) {
  const response = await fetch(ORIGIN + path, {
    headers: cookie ? { cookie } : {},
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* fail assertion on non-JSON response */ }
  return { status: response.status, text, json, headers: response.headers };
}
const endpoint = id => API_PATH + "?organizationId=" + id;

export async function proveWorkspaceReadiness() {
  // This must execute before loading an application/database module.
  requireDisposableWorkspaceReadiness();
  verifyReadinessSources();
  const [{ db, pool }, schema, { and, eq, count, isNull }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const s = schema;
  try {
    const ver = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(ver >= 160000 && ver < 170000, "Only disposable PostgreSQL 16 is allowed");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "Refuse a nonempty employer database");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "Refuse a nonempty user database");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession);
    // Unowned placeholder organizations make the victim a *real* high-ID
    // record (not a hardcoded ID such as 1..6) without adding tenant logins.
    for (let i = 0; i < 7; i++) {
      await db.insert(s.organizations).values({
        name: "Unused Synthetic Org " + i + "-" + nonce,
        legalName: "Unused Synthetic Company " + i + "-" + nonce,
      });
    }
    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    const actors = [a, b, victim];
    assert.ok(victim.org.id > 6 && victim.org.id > b.org.id &&
      b.org.id > a.org.id, "A real higher-ID third employer is required");
    assert.ok(victim.worker.id > b.worker.id && b.worker.id > a.worker.id);
    assert.equal(new Set(actors.map(x => x.cookie)).size, 3);

    // Distinct nonzero counts prove real owner-specific SQL results, not an
    // unscoped aggregation, constant success payload or empty mocked stub.
    for (const [actor, extraEmployees, payrollRunCount] of [
      [a, 0, 1], [b, 1, 2], [victim, 3, 3],
    ]) {
      for (let i = 0; i < extraEmployees; i++) {
        await db.insert(s.employees).values({
          organizationId: actor.org.id, legalEntityId: actor.entity.id,
          orgUnitId: actor.unit.id, employeeNo: actor.marker + "-X" + i,
          firstName: "Fictional", lastName: actor.marker, title: "Synthetic",
          avatarInitials: "FN", basicRate: "21000.00", restDay: "Sunday",
          startDate: "2026-01-05",
        });
      }
      for (let i = 0; i < payrollRunCount; i++) {
        await db.insert(s.payrollRuns).values({
          organizationId: actor.org.id, legalEntityId: actor.entity.id,
          periodLabel: actor.marker + " period " + i,
          periodStart: "2026-10-01", periodEnd: "2026-10-15",
          payDate: "2026-10-20", status: "Draft",
        });
      }
    }

    const [unitAdmin] = await db.insert(s.users).values({
      email: "unit-admin-" + nonce + "@example.invalid",
      name: "Fictional unit-scoped admin", passwordHash: "test-session-only",
      role: "owner", totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: unitAdmin.id, organizationId: a.org.id,
      role: "admin", orgUnitId: a.unit.id, active: true,
    });
    const limited = await fixture.standaloneMakeSession(unitAdmin.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, limited.id));

    async function counts(id) {
      const [[employees], [runs], [missing]] = await Promise.all([
        db.select({ value: count() }).from(s.employees)
          .where(eq(s.employees.organizationId, id)),
        db.select({ value: count() }).from(s.payrollRuns)
          .where(eq(s.payrollRuns.organizationId, id)),
        db.select({ value: count() }).from(s.employees)
          .where(and(eq(s.employees.organizationId, id), isNull(s.employees.restDay))),
      ]);
      return { employeeRecords: Number(employees.value),
        payrollRunRecords: Number(runs.value),
        employeesWithoutRestDay: Number(missing.value) };
    }
    const monitored = ["organizations", "userOrganizations", "employees",
      "employeePayProfiles", "payrollRuns", "auditEvents", "invoices", "outbox"];
    async function snapshot() {
      const out = {};
      for (const actor of actors) {
        out[actor.org.id] = {};
        for (const name of monitored) {
          const table = s[name];
          const column = name === "organizations" ? table.id : table.organizationId;
          assert.ok(column, "Missing tenant column: " + name);
          out[actor.org.id][name] = copy(await db.select().from(table)
            .where(eq(column, actor.org.id)).orderBy(table.id));
        }
      }
      return out;
    }
    const baseline = await snapshot();
    let ownSuccesses = 0, foreignDenials = 0, negativeChecks = 0;
    for (const actor of actors) {
      const own = await httpGet(endpoint(actor.org.id), actor.cookie);
      assertOwnedReadiness(own, actor.org.id, await counts(actor.org.id));
      for (const other of actors.filter(x => x !== actor)) {
        assert.ok(!own.text.includes(other.marker),
          "Own readiness cannot expose other fictional employer data");
      }
      assert.deepEqual(await snapshot(), baseline, "Own GET must not write SQL");
      ownSuccesses++;
    }
    for (const attacker of [a, b]) {
      for (const target of [victim, attacker === a ? b : a]) {
        const denied = await httpGet(endpoint(target.org.id), attacker.cookie);
        assert.equal(denied.status, 403,
          "Authenticated foreign employer selector cannot yield private data");
        assert.equal(Object.hasOwn(denied.json ?? {}, "evidence"), false);
        assert.ok(!denied.text.includes(target.marker));
        assert.deepEqual(await snapshot(), baseline, "Foreign denial changed SQL");
        foreignDenials++;
      }
      const forged = await httpGet(endpoint(victim.org.id) +
        "&organizationId=" + attacker.org.id, attacker.cookie);
      assert.equal(forged.status, 400,
        "Victim-first duplicated selector must be rejected before authorization");
      assert.equal(Object.hasOwn(forged.json ?? {}, "evidence"), false);
      negativeChecks++;
      const ownFirstDuplicate = await httpGet(endpoint(attacker.org.id) +
        "&organizationId=" + victim.org.id, attacker.cookie);
      assert.equal(ownFirstDuplicate.status, 400,
        "Own-first duplicated selector must not be silently accepted");
      assert.equal(Object.hasOwn(ownFirstDuplicate.json ?? {}, "evidence"), false);
      negativeChecks++;
    }
    for (const [path, cookie, expected] of [
      [endpoint(a.org.id), undefined, 401],
      [endpoint(a.org.id), limited.cookie, 403],
      [endpoint(0), a.cookie, 400],
      [endpoint("abc"), b.cookie, 400],
      [endpoint("01"), a.cookie, 400],
      [endpoint("1e0"), a.cookie, 400],
      [endpoint("1.0"), a.cookie, 400],
      [endpoint("%2B1"), a.cookie, 400],
      [endpoint("9007199254740992"), a.cookie, 400],
      [endpoint(victim.org.id + 1000), a.cookie, 403],
    ]) {
      const denial = await httpGet(path, cookie);
      assert.equal(denial.status, expected, "Wrong identity or selector accepted: " + path);
      assert.equal(Object.hasOwn(denial.json ?? {}, "evidence"), false);
      negativeChecks++;
    }
    await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    const revoked = await httpGet(endpoint(a.org.id), a.cookie);
    assert.equal(revoked.status, 403, "Revoked owner must lose own workspace access");
    await db.update(s.userOrganizations).set({ active: true })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    negativeChecks++;
    assert.deepEqual(await snapshot(), baseline,
      "Own, foreign, malformed and revoked reads must preserve all tenant SQL rows");
    assert.equal(ownSuccesses, 3);
    assert.equal(foreignDenials, 4);
    assert.equal(negativeChecks, 15);
    console.log(JSON.stringify({
      family: "tenant-workspace-readiness-api-get",
      fictionalPostgresMajor: 16, independentAuthenticatedOwners: 2,
      distinctHigherIdVictim: true, ownSuccesses, foreignDenials,
      negativeChecks, sqlStateUnchanged: true, launchApproved: false,
      payoutOrProviderCalls: 0, newMethodCredits: 0,
      independentlyAccepted: false, productionTested: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("tenant-workspace-readiness-http.mjs")) {
  await proveWorkspaceReadiness();
}
