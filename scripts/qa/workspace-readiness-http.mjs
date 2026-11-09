/**
 * Live, read-only employer readiness boundary within the disposable PG16 second pass.
 * This is provisional engineering evidence, not an API method credit or pilot approval.
 */
import assert from "node:assert/strict";

const jsonCopy = value => JSON.parse(JSON.stringify(value));
export async function verifyWorkspaceReadinessIsolation(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      !/^postgresql:\/\/[^/]+@(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL ?? "") ||
      process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" ||
      process.env.XENDIT_PAYOUTS_ENABLED === "true") {
    throw new Error("Workspace readiness proof requires disposable PostgreSQL 16 and no payouts.");
  }
  // Validate before importing database modules. These are the existing real
  // signed-in, persisted three-employer second-pass fixture identities.
  const [{ db }, s, { and, count, eq }] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"),
  ]);
  const tableNames = ["employees", "payrollRuns", "auditEvents", "invoices", "outbox"];
  const snapshots = async () => {
    const result = {};
    for (const org of f.orgs) {
      result[org.id] = {};
      for (const name of tableNames) {
        const table = s[name];
        assert.ok(table?.organizationId, "Missing protected employer column: " + name);
        result[org.id][name] = jsonCopy(await db.select().from(table)
          .where(eq(table.organizationId, org.id)).orderBy(table.id));
      }
    }
    return result;
  };
  const initialSql = await snapshots();
  for (const idx of [0, 1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownReadiness = expectStatus(await request("/api/readiness/workspace?organizationId=" +
      org.id, { cookie }), 200, "Authorized own employer receives a scoped readiness snapshot");
    assert.equal(ownReadiness.json?.organizationId, org.id);
    assert.equal(ownReadiness.json?.status, "not-launch-ready");
    assert.equal(ownReadiness.json?.manualLaunch?.ready, false);
    assert.ok(ownReadiness.json?.launchBlockersRemaining >= 1);
    assert.ok(ownReadiness.json?.scaleGapsRemaining >= 1);
    assert.ok(ownReadiness.json?.gates?.some(g =>
      g.key === "external-pilot-acceptance" && g.ready === false));
    assert.match(ownReadiness.headers.get("cache-control") ?? "", /\bno-store\b/);
    assert.equal(ownReadiness.json?.evidence?.scope, "employer-only");

    const [[roster], [runs], [missingRestDay]] = await Promise.all([
      db.select({ value: count() }).from(s.employees)
        .where(eq(s.employees.organizationId, org.id)),
      db.select({ value: count() }).from(s.payrollRuns)
        .where(eq(s.payrollRuns.organizationId, org.id)),
      db.select({ value: count() }).from(s.employees)
        .where(and(eq(s.employees.organizationId, org.id),
          // Match the server's exact per-employer null-rest-day predicate.
          (await import("drizzle-orm")).isNull(s.employees.restDay))),
    ]);
    assert.ok(Number(roster.value) > 0, "Own employer must have genuine populated worker data");
    assert.equal(ownReadiness.json.evidence.employeeRecords, Number(roster.value));
    assert.equal(ownReadiness.json.evidence.payrollRunRecords, Number(runs.value));
    assert.equal(ownReadiness.json.evidence.employeesWithoutRestDay, Number(missingRestDay.value));
    for (const sensitiveKey of ["users", "invoices", "auditChain", "providerSecrets",
      "productionPilotSignoffs", "globalCounts", "bankAccount", "tin"]) {
      assert.equal(Object.hasOwn(ownReadiness.json, sensitiveKey), false,
        "Private or platform-wide readiness attribute leaked: " + sensitiveKey);
    }
    assert.deepEqual(await snapshots(), initialSql, "Own read must be SQL read-only");

    // Two independently authenticated employers must not access a real third
    // employer, regardless of a caller-supplied organization selector.
    if (idx !== 0) {
      const victim = f.orgs[0];
      const denied = expectStatus(await request("/api/readiness/workspace?organizationId=" +
        victim.id, { cookie }), 403, "Foreign employer readiness is denied");
      assert.equal(Object.hasOwn(denied.json ?? {}, "evidence"), false);
      assert.deepEqual(await snapshots(), initialSql, "Foreign refusal must leave SQL unchanged");
    }
  }
  expectStatus(await request("/api/readiness/workspace?organizationId=" +
    f.orgs[0].id), 401, "Anonymous readiness read denied");
  expectStatus(await request("/api/readiness/workspace?organizationId=invalid",
    { cookie: f.ownerSessions[1].cookie }), 400, "Malformed selector denied");
  assert.deepEqual(await snapshots(), initialSql, "Readiness HTTP cannot mutate tenant rows");
}
