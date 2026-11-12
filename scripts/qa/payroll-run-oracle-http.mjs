/** Dedicated existence-oracle regression. Zero credits: full own-success
 * workflows must separately renew every changed route's historical proof. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ORACLE_METHODS, assertRunIndistinguishable, requireOracleEnvironment } from "./payroll-run-oracle-contract.mjs";

requireOracleEnvironment();
const [{ db, pool }, s, { and, eq }, fixture] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
try {
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "disposable PG16 only");
  assert.equal((await db.select().from(s.users).limit(1)).length, 0, "fresh empty disposable database required");
  const employers = [], nonce = randomUUID().slice(0, 8);
  for (const label of ["ATTA", "ATTB", "VICTIM"]) {
    const e = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
    [e.run] = await db.insert(s.payrollRuns).values({
      organizationId: e.org.id, legalEntityId: e.entity.id, scopeOrgUnitId: e.unit.id,
      periodLabel: e.marker + "-RUN", periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-16", status: "Draft", employeeCount: 1, grossPay: "20000.00", netPay: "18000.00",
    }).returning();
    await db.insert(s.payrollEntries).values({ payrollRunId: e.run.id, employeeId: e.worker.id,
      grossPay: "20000.00", deductions: "2000.00", netPay: "18000.00", lineItems: [] });
    employers.push(e);
  }
  const [a, b, victim] = employers;
  assert.ok(victim.run.id > a.run.id && victim.run.id > b.run.id);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
  const missingId = victim.run.id + 1000000;
  assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, missingId))).length, 0);
  // Snapshot every organization/run-owned table, not a guessed subset. Identifiers
  // come only from this fresh local schema and are validated before interpolation.
  const columns = (await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('organization_id','payroll_run_id') ORDER BY table_name,column_name")).rows;
  async function snapshot() {
    const result = {};
    for (const { table_name: table, column_name: column } of columns) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/); assert.match(column, /^[a-z_]+$/);
      result[table + ":" + column] = (await pool.query('SELECT to_jsonb(t) AS row FROM "' + table + '" t WHERE "' + column + '"=$1 ORDER BY to_jsonb(t)::text',
        [column === "organization_id" ? victim.org.id : victim.run.id])).rows;
    }
    result.victimOwner = (await pool.query("SELECT to_jsonb(u) AS row FROM users u WHERE id=$1", [victim.owner.id])).rows;
    result.victimSessions = (await pool.query("SELECT to_jsonb(t) AS row FROM sessions t WHERE user_id=$1 ORDER BY id", [victim.owner.id])).rows;
    return JSON.parse(JSON.stringify(result));
  }
  const path = (suffix, run, worker) => suffix === "ROOT"
    ? "/api/payroll-runs?runId=" + run + "&include=entries"
    : "/api/payroll-runs/" + run + "/" + suffix.replace("WORKER", String(worker));
  const request = (actor, method, suffix, run, worker, forged = false) => {
    let url = path(suffix, run, worker);
    if (forged) url += (url.includes("?") ? "&" : "?") + "organizationId=" + actor.org.id + "&payrollRunId=" + actor.run.id;
    return fixture.standaloneRequest(url, { method, cookie: actor.cookie,
      body: method === "POST" ? { mode: "preflight", action: "reconcile", organizationId: actor.org.id, payrollRunId: actor.run.id, confirm: true } : undefined });
  };
  let comparisons = 0, ownRoleDenials = 0, revokedComparisons = 0;
  // Genuine victim and both attackers can read their own populated register.
  for (const actor of employers) {
    const own = await request(actor, "GET", "ROOT", actor.run.id, actor.worker.id);
    assert.equal(own.status, 200); assert.equal(own.json.organizationId, actor.org.id);
    assert.equal(own.json.runId, actor.run.id); assert.equal(own.json.entries.length, 1);
    assert.equal(own.json.entries[0].employeeId, actor.worker.id);
  }
  const victimBefore = await snapshot();
  for (const actor of [a, b]) {
    for (const [method, suffix] of ORACLE_METHODS) {
      const missing = await request(actor, method, suffix, missingId, victim.worker.id);
      for (const forged of [false, true]) {
        const foreign = await request(actor, method, suffix, victim.run.id, victim.worker.id, forged);
        assertRunIndistinguishable(foreign, missing, [victim.marker, victim.run.periodLabel, victim.worker.employeeNo]);
        assert.deepEqual(await snapshot(), victimBefore, "denied request changed victim SQL: " + method + " " + suffix);
        comparisons++;
      }
    }
    await db.update(s.userOrganizations).set({ role: "employee" }).where(and(
      eq(s.userOrganizations.userId, actor.owner.id), eq(s.userOrganizations.organizationId, actor.org.id)));
    for (const [method, suffix] of ORACLE_METHODS) {
      const denied = await request(actor, method, suffix, actor.run.id, actor.worker.id);
      assert.equal(denied.status, 403, "member with wrong role must retain 403: " + method + " " + suffix);
      ownRoleDenials++;
    }
    await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.userId, actor.owner.id), eq(s.userOrganizations.organizationId, actor.org.id)));
    for (const [method, suffix] of ORACLE_METHODS) {
      assertRunIndistinguishable(await request(actor, method, suffix, actor.run.id, actor.worker.id),
        await request(actor, method, suffix, missingId, actor.worker.id), [actor.marker]);
      revokedComparisons++;
    }
    assert.deepEqual(await snapshot(), victimBefore, "role/revocation probes changed victim SQL");
  }
  assert.equal(comparisons, 76); assert.equal(ownRoleDenials, 38); assert.equal(revokedComparisons, 38);
  console.log("PAYROLL_RUN_ORACLE_PASS " + JSON.stringify({ methods: ORACLE_METHODS.length, comparisons, ownRoleDenials,
    revokedComparisons, ownRegisterPositives: 3, higherIdVictim: true, unchangedVictimSql: true,
    providerCalls: 0, coverageCredits: 0, label: "SOLO_VERIFIED_DEV_RECOVERY", productionCertified: false }));
} finally { await pool.end(); }
