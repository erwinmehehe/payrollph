/**
 * Issue #1102: rehearsal ONLY. Recreates the three historical fictitious
 * public-demo payroll headers inside session-local pg_temp tables, compares
 * their six fictional line items, tests guarded UPDATEs and ROLLBACK.
 *
 * NEVER updates an actual public payroll table. Requires disposable GitHub
 * Actions PG16/PG18 app_db on loopback and no real employer information.
 * This is NOT a migration, repair command, payroll calculation, or approval.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { fictionalPublicDemoPayroll, PUBLIC_DEMO_PAYROLL_WORKERS } from "../../src/lib/public-demo-payroll-fixture.ts";

const SPECS = [
  {
    id: 1, status: "Released", period: "Aug 16–31, 2026",
    start: "2026-08-16", end: "2026-08-31", paid: "2026-09-05",
    oldGross: "176300.00", oldNet: "145645.00",
    entryGross: "181300.00", entryNet: "147400.00",
  },
  {
    id: 2, status: "Pending approval", period: "Sep 1–15, 2026",
    start: "2026-09-01", end: "2026-09-15", paid: "2026-09-18",
    oldGross: "181250.00", oldNet: "149768.00",
    entryGross: "182800.00", entryNet: "148600.00",
  },
  {
    id: 3, status: "Needs review", period: "Sep 16–30, 2026",
    start: "2026-09-16", end: "2026-09-30", paid: "2026-10-05",
    oldGross: "183400.00", oldNet: "151524.00",
    entryGross: "184300.00", entryNet: "149800.00",
  },
];
const ORG_ID = 42;

function requireDisposableCiTarget() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true", "CI_REQUIRED");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "GITHUB_ACTIONS_REQUIRED");
  assert.equal(process.env.DEMO_MODE, "true", "FICTIONAL_MODE_REQUIRED");
  assert.equal(url.hostname, "127.0.0.1", "DISPOSABLE_LOOPBACK_ONLY");
  assert.equal(url.port, "5432", "DISPOSABLE_PORT_ONLY");
  assert.equal(url.pathname, "/app_db", "DISPOSABLE_APP_DB_ONLY");
  assert.equal(url.username, "postgres", "DISPOSABLE_PG_USER_ONLY");
  assert.equal(url.password, "postgres", "DISPOSABLE_PG_CREDENTIALS_ONLY");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false", "PAYOUT_DISABLED_REQUIRED");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false", "XENDIT_DISABLED_REQUIRED");
  return url.toString();
}

async function assertBareDisposableDatabase(client) {
  const identity = await client.query("SELECT current_database() AS database, current_user AS role");
  assert.deepEqual(identity.rows[0], { database: "app_db", role: "postgres" });
  const count = await client.query(
    "SELECT COUNT(*)::integer AS total FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_temp_%' AND schemaname NOT LIKE 'pg_toast%'",
  );
  assert.equal(count.rows[0].total, 0, "REQUIRES_EMPTY_THROWAWAY_DATABASE");
}

// All relations are TEMP and every subsequent relation reference is explicitly
// qualified pg_temp. They disappear on connection termination.
async function seedTemporaryHistoricalDemo(client) {
  await client.query("CREATE TEMP TABLE rehearsal_orgs(id integer PRIMARY KEY, name text NOT NULL) ON COMMIT PRESERVE ROWS");
  await client.query("CREATE TEMP TABLE rehearsal_employees(id integer PRIMARY KEY, organization_id integer NOT NULL) ON COMMIT PRESERVE ROWS");
  await client.query("CREATE TEMP TABLE rehearsal_payroll_runs(id integer PRIMARY KEY, organization_id integer NOT NULL, period_label text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, pay_date date NOT NULL, status text NOT NULL, employee_count integer NOT NULL, gross_pay numeric(18,2) NOT NULL, net_pay numeric(18,2) NOT NULL) ON COMMIT PRESERVE ROWS");
  await client.query("CREATE TEMP TABLE rehearsal_payroll_entries(id integer PRIMARY KEY, payroll_run_id integer NOT NULL, employee_id integer NOT NULL, gross_pay numeric(18,2) NOT NULL, deductions numeric(18,2) NOT NULL, net_pay numeric(18,2) NOT NULL) ON COMMIT PRESERVE ROWS");
  await client.query("INSERT INTO pg_temp.rehearsal_orgs VALUES ($1,$2)", [ORG_ID, "Loom & Local"]);
  for (let worker = 0; worker < 8; worker++) {
    await client.query("INSERT INTO pg_temp.rehearsal_employees VALUES ($1,$2)", [101 + worker, ORG_ID]);
  }
  for (const [index, spec] of SPECS.entries()) {
    const fixture = fictionalPublicDemoPayroll(index);
    assert.equal(fixture.entries.length, PUBLIC_DEMO_PAYROLL_WORKERS);
    assert.equal(fixture.grossPay, spec.entryGross, "SIX_WORKER_GROSS_REFERENCE_DRIFT");
    assert.equal(fixture.netPay, spec.entryNet, "SIX_WORKER_NET_REFERENCE_DRIFT");
    await client.query(
      "INSERT INTO pg_temp.rehearsal_payroll_runs(id,organization_id,period_label,period_start,period_end,pay_date,status,employee_count,gross_pay,net_pay) VALUES ($1,$2,$3,$4,$5,$6,$7,6,$8,$9)",
      [spec.id, ORG_ID, spec.period, spec.start, spec.end, spec.paid, spec.status, spec.oldGross, spec.oldNet],
    );
    for (const [worker, entry] of fixture.entries.entries()) {
      await client.query(
        "INSERT INTO pg_temp.rehearsal_payroll_entries(id,payroll_run_id,employee_id,gross_pay,deductions,net_pay) VALUES ($1,$2,$3,$4,$5,$6)",
        [index * 6 + worker + 1, spec.id, worker + 101,
          entry.gross.toFixed(2), entry.deductions.toFixed(2), entry.net.toFixed(2)],
      );
    }
  }
}

async function headerSnapshot(client) {
  const r = await client.query(
    "SELECT id,organization_id,period_label,period_start::text,period_end::text,pay_date::text,status,employee_count,gross_pay::text,net_pay::text FROM pg_temp.rehearsal_payroll_runs ORDER BY id",
  );
  return r.rows;
}

async function aggregates(client) {
  const r = await client.query(
    "SELECT r.id,r.organization_id,r.period_label,r.period_start::text,r.period_end::text,r.pay_date::text,r.status,r.employee_count,r.gross_pay::text AS header_gross,r.net_pay::text AS header_net, o.name AS org_name,COUNT(e.id)::integer AS entry_count,COUNT(DISTINCT e.employee_id)::integer AS distinct_workers,COALESCE(SUM(e.gross_pay),0)::numeric(18,2)::text AS detail_gross,COALESCE(SUM(e.net_pay),0)::numeric(18,2)::text AS detail_net,COUNT(e.id) FILTER (WHERE e.gross_pay-e.deductions<>e.net_pay OR w.id IS NULL OR w.organization_id<>r.organization_id)::integer AS bad_entries FROM pg_temp.rehearsal_payroll_runs r JOIN pg_temp.rehearsal_orgs o ON o.id=r.organization_id LEFT JOIN pg_temp.rehearsal_payroll_entries e ON e.payroll_run_id=r.id LEFT JOIN pg_temp.rehearsal_employees w ON w.id=e.employee_id GROUP BY r.id,r.organization_id,r.period_label,r.period_start,r.period_end,r.pay_date,r.status,r.employee_count,r.gross_pay,r.net_pay,o.name ORDER BY r.id",
  );
  return r.rows;
}

async function strictlyGuardedRehearsalUpdate(client) {
  // Inside BEGIN. Locks are simulation-only; no public database rows touched.
  await client.query("SELECT id FROM pg_temp.rehearsal_payroll_runs ORDER BY id FOR UPDATE");
  const identity = await client.query(
    "SELECT (SELECT COUNT(*)::integer FROM pg_temp.rehearsal_orgs) AS org_count,(SELECT COUNT(*)::integer FROM pg_temp.rehearsal_employees) AS workers,(SELECT COUNT(*)::integer FROM pg_temp.rehearsal_payroll_runs) AS runs,(SELECT COUNT(*)::integer FROM pg_temp.rehearsal_payroll_entries) AS entries",
  );
  assert.deepEqual(identity.rows[0], { org_count: 1, workers: 8, runs: 3, entries: 18 }, "EXACT_FICTIONAL_SCOPE_REQUIRED");
  const before = await aggregates(client);
  assert.equal(before.length, SPECS.length, "THREE_RUNS_EXACTLY");
  for (const spec of SPECS) {
    const row = before.find((r) => r.id === spec.id);
    assert.ok(row, "MISSING_EXPECTED_FICTIONAL_RUN");
    assert.equal(row.organization_id, ORG_ID, "FOREIGN_ORGANIZATION");
    assert.equal(row.org_name, "Loom & Local", "WRONG_FICTIONAL_COMPANY");
    assert.equal(row.period_label, spec.period, "PERIOD_LABEL_CHANGED");
    assert.equal(row.period_start, spec.start, "PERIOD_START_CHANGED");
    assert.equal(row.period_end, spec.end, "PERIOD_END_CHANGED");
    assert.equal(row.pay_date, spec.paid, "PAY_DATE_CHANGED");
    assert.equal(row.status, spec.status, "STATUS_CHANGED");
    assert.equal(row.employee_count, 6, "WRONG_RECORDED_WORKER_COUNT");
    assert.equal(row.entry_count, 6, "INCOMPLETE_PAYROLL_DETAILS");
    assert.equal(row.distinct_workers, 6, "DUPLICATE_EMPLOYEE_DETAILS");
    assert.equal(row.bad_entries, 0, "ENTRY_GROSS_MINUS_DEDUCTIONS_MISMATCH");
    assert.equal(row.header_gross, spec.oldGross, "STALE_GROSS_HEADER");
    assert.equal(row.header_net, spec.oldNet, "STALE_NET_HEADER");
    assert.equal(row.detail_gross, spec.entryGross, "UNEXPECTED_GROSS_DETAILS");
    assert.equal(row.detail_net, spec.entryNet, "UNEXPECTED_NET_DETAILS");
  }
  let changed = 0;
  for (const spec of SPECS) {
    const row = before.find((r) => r.id === spec.id);
    const updated = await client.query(
      "UPDATE pg_temp.rehearsal_payroll_runs SET gross_pay=$1,net_pay=$2 WHERE id=$3 AND organization_id=$4 AND period_label=$5 AND period_start=$6::date AND period_end=$7::date AND status=$8 AND gross_pay=$9::numeric AND net_pay=$10::numeric RETURNING id",
      [row.detail_gross, row.detail_net, spec.id, ORG_ID, spec.period,
        spec.start, spec.end, spec.status, spec.oldGross, spec.oldNet],
    );
    assert.equal(updated.rowCount, 1, "COMPARE_AND_SWAP_REFUSED");
    changed += updated.rowCount;
  }
  assert.equal(changed, 3, "MUST_CHANGE_EXACTLY_THREE_TEMP_HEADERS");
  const after = await aggregates(client);
  for (const row of after) {
    assert.equal(row.header_gross, row.detail_gross, "GROSS_DID_NOT_RECONCILE");
    assert.equal(row.header_net, row.detail_net, "NET_DID_NOT_RECONCILE");
    assert.equal(row.entry_count, 6);
    assert.equal(row.bad_entries, 0);
  }
  return { before, after, changed };
}

async function expectGuardToBlock(client, sql, params, marker) {
  await client.query("BEGIN");
  try {
    await client.query(sql, params);
    await assert.rejects(() => strictlyGuardedRehearsalUpdate(client), marker);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  const connectionString = requireDisposableCiTarget();
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await assertBareDisposableDatabase(client);
    await seedTemporaryHistoricalDemo(client);
    const before = await headerSnapshot(client);
    assert.equal(before.length, 3);
    await expectGuardToBlock(client,
      "UPDATE pg_temp.rehearsal_payroll_runs SET gross_pay=0 WHERE id=1", [],
      /STALE_GROSS_HEADER/);
    await expectGuardToBlock(client,
      "UPDATE pg_temp.rehearsal_payroll_runs SET status='Wrong status' WHERE id=2", [],
      /STATUS_CHANGED/);
    await expectGuardToBlock(client,
      "UPDATE pg_temp.rehearsal_payroll_entries SET deductions=0 WHERE id=1", [],
      /ENTRY_GROSS_MINUS_DEDUCTIONS_MISMATCH/);
    await expectGuardToBlock(client,
      "DELETE FROM pg_temp.rehearsal_payroll_entries WHERE id=1", [],
      /EXACT_FICTIONAL_SCOPE_REQUIRED/);
    await expectGuardToBlock(client,
      "UPDATE pg_temp.rehearsal_orgs SET name='Other company' WHERE id=$1", [ORG_ID],
      /WRONG_FICTIONAL_COMPANY/);
    assert.deepEqual(await headerSnapshot(client), before,
      "NEGATIVE_TESTS_MUST_RESTORE_ORIGINAL_HEADERS");

    await client.query("BEGIN");
    try {
      const { changed, after } = await strictlyGuardedRehearsalUpdate(client);
      await assert.rejects(() => strictlyGuardedRehearsalUpdate(client),
        /STALE_GROSS_HEADER/, "REPLAY_SHOULD_BE_DENIED");
      assert.equal(changed, 3);
      assert.equal(after.length, 3);
    } finally {
      // Intentional rollback: the rehearsal NEVER commits even its TEMP rows.
      await client.query("ROLLBACK");
    }
    assert.deepEqual(await headerSnapshot(client), before, "REHEARSAL_ROLLBACK_MUST_RESTORE_HEADERS");
    const post = await aggregates(client);
    assert.equal(post.length, 3);
    assert.ok(post.every((x) => x.header_gross !== x.detail_gross && x.header_net !== x.detail_net));
    console.log(JSON.stringify({
      result: "PASS",
      scope: "DISPOSABLE_LOCAL_POSTGRES_TEMP_ONLY",
      historicalDemoRuns: 3, preservedFictionalWorkers: 8,
      fictionalDetailEntries: 18, simulatedHeaderChanges: 3,
      negativeControls: 5, replayRefused: true, rolledBack: true,
      currentNeonDatabaseModified: false, realPayrollReconciliation: false,
      approvedToApplyOriginalDatabase: false,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("ISSUE_1102_REHEARSAL_FAILED: " + (error instanceof Error ? error.message : "unknown"));
  process.exitCode = 1;
});
