/**
 * Multi-entity payroll variance: genuine signed-in HTTPS, disposable PG16.
 * No real employees, approvals, calculation, provider requests or money.
 * A2 transfer/cross-tenant FK mismatch is TEMPORARY and restored in finally.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";

const path = runId => "/api/payroll-runs/" + runId + "/variance";

function requireDisposable() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(url.hostname, new URL(process.env.APP_BASE_URL ?? "").hostname);
}

async function originalRow(db, table, id) {
  const allowlisted = {
    employees: "employees",
    payroll_entries: "payroll_entries",
  };
  assert.ok(Object.hasOwn(allowlisted, table));
  const { rows } = await db.query(
    "SELECT to_jsonb(t) AS record FROM " + allowlisted[table] + " t WHERE id=$1", [id],
  );
  assert.equal(rows.length, 1);
  return rows[0].record;
}

async function changeSyntheticRow(db, table, id, column, value) {
  assert.ok((table === "employees" && column === "legal_entity_id") ||
    (table === "payroll_entries" && column === "employee_id"),
  "Only two known disposable mismatch fields may be temporarily changed");
  await db.query("BEGIN");
  try {
    // The isolated baseline may use composite FKs. This *superuser-only*
    // fixture transaction intentionally simulates a malformed historical
    // imported row and commits it so the separate Next.js connection sees it.
    // Restore immediately, even on test failure; no production connection.
    await db.query("SET LOCAL session_replication_role = replica");
    const result = await db.query(
      "UPDATE " + table + " SET " + column + "=$1 WHERE id=$2", [value, id],
    );
    assert.equal(result.rowCount, 1);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function snapshotTenant(db, organizationId) {
  // pg.Client is one connection: never launch concurrent queries on it.
  const staff = await db.query("SELECT to_jsonb(e) AS row FROM employees e WHERE organization_id=$1 ORDER BY id",
    [organizationId]);
  const runs = await db.query("SELECT to_jsonb(r) AS row FROM payroll_runs r WHERE organization_id=$1 ORDER BY id",
    [organizationId]);
  const entries = await db.query("SELECT to_jsonb(p) AS row FROM payroll_entries p JOIN payroll_runs r ON r.id=p.payroll_run_id WHERE r.organization_id=$1 ORDER BY p.id",
    [organizationId]);
  const audit = await db.query("SELECT to_jsonb(a) AS row FROM audit_events a WHERE organization_id=$1 ORDER BY id",
    [organizationId]);
  return [staff.rows, runs.rows, entries.rows, audit.rows];
}

export async function verifyPayrollVarianceEmployerIsolation({
  newSyntheticContext, login, request, on, off, checks,
}) {
  requireDisposable();
  assert.equal(on, "https://127.0.0.1:3000");
  assert.equal(off, "https://127.0.0.1:3001");
  const nonce = randomUUID().slice(0, 8);
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const contexts = [];
  const runIds = [];
  let victimWorkerId = null;
  let employeeOrigin = null;
  let entryOrigin = null;
  let mutatedEmployeeId = null;
  let mutatedEntryId = null;
  await database.connect();
  try {
    const entities = await database.query(
      "SELECT id, organization_id, primary_entity FROM legal_entities WHERE organization_id IN (1,2,3) ORDER BY id",
    );
    const workers = await database.query(
      "SELECT id, organization_id, legal_entity_id, employee_no FROM employees WHERE employee_no IN ('A-01','A-02','B-01','C-01') ORDER BY id",
    );
    const employer = org => entities.rows.find(row => row.organization_id === org && row.primary_entity === true);
    const a1 = employer(1), b1 = employer(2), c1 = employer(3);
    const a2 = entities.rows.find(row => row.organization_id === 1 && row.id !== a1?.id);
    const worker = number => workers.rows.find(row => row.employee_no === number);
    assert.ok(a1 && a2 && b1 && c1);
    assert.equal(worker("A-01")?.legal_entity_id, a1.id);
    assert.equal(worker("A-02")?.legal_entity_id, a2.id);
    assert.equal(worker("B-01")?.legal_entity_id, b1.id);
    assert.equal(worker("C-01")?.legal_entity_id, c1.id);

    const insertRun = async (org, entity, label, periodStart, payDate, count) => {
      const { rows } = await database.query(
        "INSERT INTO payroll_runs (organization_id, legal_entity_id, period_label, period_start, period_end, pay_date, status, employee_count, processed_chunks, total_chunks, gross_pay, net_pay)" +
        " VALUES ($1,$2,$3,$4,$5,$5,'Draft',$6,1,1,$7,$7) RETURNING id",
        [org, entity, label, periodStart, payDate, count, count ? "1000.00" : "0.00"],
      );
      runIds.push(rows[0].id);
      return rows[0].id;
    };
    const insertEntry = async (runId, workerId, legalEntityId, amount) => {
      const { rows } = await database.query(
        "INSERT INTO payroll_entries (payroll_run_id, employee_id, legal_entity_id, gross_pay, deductions, net_pay, status)" +
        " VALUES ($1,$2,$3,$4,'0.00',$4,'Ready') RETURNING id",
        [runId, workerId, legalEntityId, amount],
      );
      return rows[0].id;
    };
    const aRun = await insertRun(1, a1.id, "variance-own-a-" + nonce, "2026-06-01", "2026-06-15", 1);
    const bRun = await insertRun(2, b1.id, "variance-own-b-" + nonce, "2026-06-01", "2026-06-15", 1);
    const aEntry = await insertEntry(aRun, worker("A-01").id, a1.id, "1000.00");
    await insertEntry(bRun, worker("B-01").id, b1.id, "1000.00");

    const victimEmployee = await database.query(
      "INSERT INTO employees (organization_id,legal_entity_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date)" +
      " VALUES (3,$1,$2,'QA Victim','Variance','Fictional Worker','QV','9876.00','2026-05-01') RETURNING id",
      [c1.id, "C-VICTIM-VARIANCE-" + nonce],
    );
    victimWorkerId = victimEmployee.rows[0].id;
    assert.ok(victimWorkerId > 6 && victimWorkerId > worker("B-01").id);
    for (let i = 0; i < 3; i++) {
      await insertRun(3, c1.id, "variance-victim-filler-" + nonce + "-" + i, "2026-02-01", "2026-02-15", 0);
    }
    const victimRun = await insertRun(3, c1.id, "variance-real-victim-" + nonce, "2026-06-01", "2026-06-15", 1);
    await insertEntry(victimRun, victimWorkerId, c1.id, "9876.00");
    assert.ok(victimRun > 6 && victimRun > aRun && victimRun > bRun,
      "Real foreign victim run must exceed both attacker-owned run IDs");
    const beforeC = await snapshotTenant(database, 3);

    const actors = [
      { name: "A", email: "entity-owner@example.test", runId: aRun, ownEntity: a1.id, otherRunId: bRun },
      { name: "B", email: "entity-foreign@example.test", runId: bRun, ownEntity: b1.id, otherRunId: aRun },
    ];
    for (const actor of actors) {
      const ctx = await newSyntheticContext();
      contexts.push(ctx);
      await login(ctx, on, actor.email);
      const own = await request(ctx, on, path(actor.runId) + "?legalEntityId=" + actor.ownEntity);
      assert.equal(own.status, 200, actor.name + ": real own-employer variance GET must succeed");
      assert.equal(own.data?.run?.id, actor.runId);
      assert.equal(own.data?.summary?.calculatedEntries, 1);
      assert.equal(own.data?.legalEntityId, actor.ownEntity);
      const other = await request(ctx, on, path(actor.otherRunId));
      assert.equal(other.status, 403, actor.name + ": other tenant's real owned run denied");
      const victim = await request(ctx, on, path(victimRun));
      assert.equal(victim.status, 403, actor.name + ": higher-ID real victim run denied");
      assert.ok(!JSON.stringify(victim.data).includes("C-VICTIM-VARIANCE-" + nonce));
      checks.push("Variance " + actor.name + " real own 200 / foreign 403 / high-ID victim 403");
    }
    const a = contexts[0];
    const wrongSelection = await request(a, on, path(aRun) + "?legalEntityId=" + a2.id);
    assert.equal(wrongSelection.status, 403,
      "Same-tenant owner granted BOTH employers cannot forge selection for the run");
    const noGrant = await newSyntheticContext();
    contexts.push(noGrant);
    await login(noGrant, on, "entity-nogrant@example.test");
    assert.equal((await request(noGrant, on, path(aRun))).status, 403);
    checks.push("Variance owner-other-employer selection and ungranted owner denied");

    // A valid CURRENT run still cannot borrow a previously Released run's
    // wrongly attributed A2 employee when both runs claim frozen employer A1.
    // These "Released" rows are fictional comparison fixtures, NOT a payroll
    // release API or authority to move money.
    const priorRun = await insertRun(1, a1.id,
      "variance-prior-wrong-employer-" + nonce, "2026-05-01", "2026-05-15", 1);
    await database.query("UPDATE payroll_runs SET status='Released' WHERE id=$1 AND organization_id=1", [priorRun]);
    // Respect the reviewed composite payroll-run/employer FK at creation.
    // Only afterwards simulate a corrupted imported entry in LOCAL CI with
    // session_replication_role=replica, and restore it in the finally path.
    const priorEntry = await insertEntry(priorRun, worker("A-01").id, a1.id, "4321.00");
    await changeSyntheticRow(database, "payroll_entries", priorEntry,
      "employee_id", worker("A-02").id);
    try {
      const wrongPrior = await request(a, on, path(aRun) + "?legalEntityId=" + a1.id);
      assert.equal(wrongPrior.status, 409,
        "A prior Released comparison from a different legal employer must not enter variance");
      assert.equal(wrongPrior.data?.code, "PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED");
      checks.push("Prior-run wrong-employer payroll entry blocked before salary comparison");
    } finally {
      await changeSyntheticRow(database, "payroll_entries", priorEntry,
        "employee_id", worker("A-01").id);
      await database.query("DELETE FROM payroll_entries WHERE payroll_run_id=$1", [priorRun]);
      await database.query("DELETE FROM payroll_runs WHERE id=$1", [priorRun]);
    }

    employeeOrigin = await originalRow(database, "employees", worker("A-01").id);
    mutatedEmployeeId = worker("A-01").id;
    try {
      await changeSyntheticRow(database, "employees", mutatedEmployeeId, "legal_entity_id", a2.id);
      const moved = await request(a, on, path(aRun) + "?legalEntityId=" + a1.id);
      assert.equal(moved.status, 409, "Transferred employee must block historical salary variance");
      assert.equal(moved.data?.code, "PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED");
      assert.ok(!JSON.stringify(moved.data).includes("1000.00"));
      checks.push("Transferred employee remains blocked until historical employer is reconciled");
    } finally {
      await changeSyntheticRow(database, "employees", mutatedEmployeeId, "legal_entity_id", a1.id);
      assert.deepEqual(await originalRow(database, "employees", mutatedEmployeeId), employeeOrigin);
      mutatedEmployeeId = null;
    }

    // A run may also contain an employee from another legal employer inside
    // the SAME organization. It is not enough to check organization_id alone.
    entryOrigin = await originalRow(database, "payroll_entries", aEntry);
    mutatedEntryId = aEntry;
    try {
      await changeSyntheticRow(database, "payroll_entries", aEntry, "employee_id", worker("A-02").id);
      const wrongSameTenant = await request(a, on, path(aRun) + "?legalEntityId=" + a1.id);
      assert.equal(wrongSameTenant.status, 409,
        "Current same-tenant other-employer employee must never enter A1 payroll variance");
      assert.equal(wrongSameTenant.data?.code, "PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED");
      checks.push("Same-tenant A2 worker in A1 payroll entry blocked before salary report");
    } finally {
      await changeSyntheticRow(database, "payroll_entries", aEntry, "employee_id", worker("A-01").id);
      assert.deepEqual(await originalRow(database, "payroll_entries", aEntry), entryOrigin);
      mutatedEntryId = null;
    }

    entryOrigin = await originalRow(database, "payroll_entries", aEntry);
    mutatedEntryId = aEntry;
    try {
      await changeSyntheticRow(database, "payroll_entries", aEntry, "employee_id", victimWorkerId);
      const malformed = await request(a, on, path(aRun) + "?legalEntityId=" + a1.id);
      assert.equal(malformed.status, 409, "Cross-tenant payroll-entry FK must not become a partial report");
      assert.equal(malformed.data?.code, "PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED");
      assert.ok(!JSON.stringify(malformed.data).includes("C-VICTIM-VARIANCE-" + nonce));
      checks.push("Cross-tenant legacy payroll-entry FK is denied without salary disclosure");
    } finally {
      await changeSyntheticRow(database, "payroll_entries", aEntry, "employee_id", worker("A-01").id);
      assert.deepEqual(await originalRow(database, "payroll_entries", aEntry), entryOrigin);
      mutatedEntryId = null;
    }

    const restored = await request(a, on, path(aRun) + "?legalEntityId=" + a1.id);
    assert.equal(restored.status, 200, "Clean own-employer variance access must recover after restoration");
    const legacy = await newSyntheticContext();
    contexts.push(legacy);
    await login(legacy, off, "entity-owner@example.test");
    const offOwn = await request(legacy, off, path(aRun));
    assert.equal(offOwn.status, 200, "Feature-OFF variance read compatibility preserved");
    assert.equal(offOwn.data?.summary?.calculatedEntries, 1);
    const afterC = await snapshotTenant(database, 3);
    assert.deepEqual(afterC, beforeC,
      "Victim employee, payroll entry, run and audit DB state must remain unchanged");
    checks.push("Variance flag-OFF compatibility and identical victim PostgreSQL snapshot");
    console.log(JSON.stringify({
      kind: "REAL_HTTPS_DISPOSABLE_PG16_ONLY",
      scope: "payroll-variance-frozen-employer", ownPositives: 2,
      independentAttackerOrganizations: 2, victimDatabaseUnchanged: true,
      sentMoney: false, productionCertified: false, accepted: false,
    }));
  } finally {
    // Restore EVERY temporarily corrupted synthetic row before fixture cleanup.
    if (mutatedEmployeeId !== null && employeeOrigin)
      await changeSyntheticRow(database, "employees", mutatedEmployeeId,
        "legal_entity_id", employeeOrigin.legal_entity_id);
    if (mutatedEntryId !== null && entryOrigin)
      await changeSyntheticRow(database, "payroll_entries", mutatedEntryId,
        "employee_id", entryOrigin.employee_id);
    for (const context of contexts) await context.close().catch(() => {});
    if (runIds.length) {
      await database.query("DELETE FROM payroll_entries WHERE payroll_run_id=ANY($1::integer[])", [runIds]);
      await database.query("DELETE FROM payroll_runs WHERE id=ANY($1::integer[])", [runIds]);
    }
    if (victimWorkerId !== null)
      await database.query("DELETE FROM employees WHERE id=$1 AND organization_id=3", [victimWorkerId]);
    await database.end();
  }
}
