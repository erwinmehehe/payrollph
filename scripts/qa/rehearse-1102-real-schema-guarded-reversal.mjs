/**
 * Issue #1102. Production-SHAPED but STRICTLY DISPOSABLE test.
 * Runs only on a fresh GitHub Actions service PostgreSQL app_db on loopback.
 * Uses actual repository db:push tables and the real fictional public-demo
 * seeder. NEVER connects to Neon, never exports personal data, never pays.
 *
 * 1. Seed new consistent fictional data (8 staff, 3 runs, 18 entries).
 * 2. Reproduce the observed 2026 legacy headers in disposable public tables.
 * 3. Refuse wrong identity, counts, dates, status, source maths or remittance
 *    evidence; emulate a guarded header-only correction.
 * 4. Commit the correction on DISPOSABLE PostgreSQL, then commit an equally
 *    guarded reversal back to the old values; test rollback and stale replay.
 * 5. Verify original synthetic employee/details/audit/approval rows unchanged.
 *
 * A successful run is NOT approval for an original Neon update or bank action.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { pool } from "../../src/db/index.ts";
import { ensurePublicDemoTenant } from "../../src/db/public-demo.ts";

const FIXTURES = Object.freeze([
  {
    id: 1, label: "Aug 16–31, 2026", start: "2026-08-16", end: "2026-08-31",
    paid: "2026-09-05", status: "Released",
    oldGross: "176300.00", oldNet: "145645.00",
    correctGross: "181300.00", correctNet: "147400.00",
  },
  {
    id: 2, label: "Sep 1–15, 2026", start: "2026-09-01", end: "2026-09-15",
    paid: "2026-09-18", status: "Pending approval",
    oldGross: "181250.00", oldNet: "149768.00",
    correctGross: "182800.00", correctNet: "148600.00",
  },
  {
    id: 3, label: "Sep 16–30, 2026", start: "2026-09-16", end: "2026-09-30",
    paid: "2026-10-05", status: "Needs review",
    oldGross: "183400.00", oldNet: "151524.00",
    correctGross: "184300.00", correctNet: "149800.00",
  },
]);

function requireDisposableAction() {
  const raw = process.env.DATABASE_URL ?? "";
  const url = new URL(raw);
  assert.equal(process.env.GITHUB_ACTIONS, "true", "GITHUB_ACTIONS_REQUIRED");
  assert.equal(process.env.CI, "true", "CI_REQUIRED");
  assert.equal(process.env.DEMO_MODE, "true", "FICTIONAL_DEMO_REQUIRED");
  assert.equal(process.env.NODE_ENV, "test", "TEST_ENVIRONMENT_REQUIRED");
  assert.equal(process.env.GITHUB_REPOSITORY, "erwinmehehe/payrollph", "REPOSITORY_GUARD");
  assert.equal(url.protocol, "postgresql:", "REQUIRES_PG_URL");
  assert.equal(url.hostname, "127.0.0.1", "NEVER_REMOTE_DATABASE");
  assert.equal(url.port, "5432", "DISPOSABLE_PORT_ONLY");
  assert.equal(url.pathname, "/app_db", "DISPOSABLE_APP_DB_ONLY");
  assert.equal(url.username, "postgres", "DISPOSABLE_PG_USER_ONLY");
  assert.equal(url.password, "postgres", "DISPOSABLE_PG_PASSWORD_ONLY");
  assert.equal(url.search, "", "NO_URL_OVERRIDES");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_LIVE_APPROVED, "false");
  assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined, "NO_PRODUCTION_DB_CREDENTIAL");
  return url.toString();
}

function centavos(value) {
  const str = String(value);
  assert.match(str, /^-?[0-9]+[.][0-9]{2}$/, "MONETARY_AMOUNT_MUST_BE_EXACT_CENTAVOS");
  return BigInt(str.replace(".", ""));
}

async function checkEmptyFixture(client) {
  const { rows: [identity] } = await client.query(
    "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS server"
  );
  assert.equal(identity.database, "app_db");
  assert.equal(identity.role, "postgres");
  const { rows: [c] } = await client.query([
    "SELECT",
    "(SELECT COUNT(*)::int FROM public.organizations) AS organizations,",
    "(SELECT COUNT(*)::int FROM public.employees) AS employees,",
    "(SELECT COUNT(*)::int FROM public.payroll_runs) AS runs,",
    "(SELECT COUNT(*)::int FROM public.payroll_entries) AS entries",
  ].join(" "));
  assert.deepEqual(c, { organizations: 0, employees: 0, runs: 0, entries: 0 },
    "SCHEMA_REHEARSAL_REQUIRES_EMPTY_DISPOSABLE_BUSINESS_TABLES");
}

async function readState(client) {
  const orgs = (await client.query(
    "SELECT id,name FROM public.organizations ORDER BY id"
  )).rows;
  const staff = (await client.query(
    "SELECT id,organization_id FROM public.employees ORDER BY id"
  )).rows;
  const runs = (await client.query([
    "SELECT id,organization_id,period_label,period_start::text,period_end::text,",
    "pay_date::text,status,employee_count,gross_pay::numeric(18,2)::text AS gross,",
    "net_pay::numeric(18,2)::text AS net",
    "FROM public.payroll_runs ORDER BY id",
  ].join(" "))).rows;
  const entries = (await client.query([
    "SELECT e.id,e.payroll_run_id,e.employee_id,w.organization_id AS employee_org_id,",
    "e.gross_pay::numeric(18,2)::text AS gross,",
    "e.deductions::numeric(18,2)::text AS deductions,",
    "e.net_pay::numeric(18,2)::text AS net",
    "FROM public.payroll_entries e LEFT JOIN public.employees w ON w.id=e.employee_id",
    "ORDER BY e.payroll_run_id,e.id",
  ].join(" "))).rows;
  return { orgs, staff, runs, entries };
}

async function countLinkedEvidence(client) {
  const ids = FIXTURES.map(x => x.id);
  const rows = (await client.query([
    "SELECT",
    "(SELECT COUNT(*)::int FROM public.approval_tasks WHERE payroll_run_id=ANY($1::int[])) AS linked_approvals,",
    "(SELECT COUNT(*)::int FROM public.bank_file_validations WHERE payroll_run_id=ANY($1::int[])) AS bank_files,",
    "(SELECT COUNT(*)::int FROM public.government_filing_validations WHERE payroll_run_id=ANY($1::int[])) AS filings,",
    "(SELECT COUNT(*)::int FROM public.managed_payroll_run_approvals WHERE payroll_run_id=ANY($1::int[])) AS managed_approvals,",
    "(SELECT COUNT(*)::int FROM public.payroll_jobs WHERE payroll_run_id=ANY($1::int[])) AS jobs,",
    "(SELECT COUNT(*)::int FROM public.employee_pay_retro_adjustments WHERE",
    "source_payroll_run_id=ANY($1::int[]) OR settled_payroll_run_id=ANY($1::int[])) AS retro,",
    "(SELECT COUNT(*)::int FROM public.payslips WHERE payroll_entry_id IN",
    "(SELECT id FROM public.payroll_entries WHERE payroll_run_id=ANY($1::int[]))) AS payslips",
  ].join(" "), [ids])).rows;
  assert.equal(rows.length, 1);
  for (const [name, count] of Object.entries(rows[0])) {
    assert.equal(count, 0, "UNEXPECTED_LINKED_EVIDENCE_" + name);
  }
}

async function inspect(client, stage) {
  const state = await readState(client);
  assert.equal(state.orgs.length, 1, "ORG_SCOPE_MUST_BE_FICTIONAL_ONLY");
  assert.equal(state.orgs[0].name, "Loom & Local", "WRONG_FICTIONAL_ORGANIZATION");
  assert.equal(state.staff.length, 8, "EIGHT_FICTIONAL_EMPLOYEES_REQUIRED");
  assert.ok(state.staff.every(x => x.organization_id === state.orgs[0].id),
    "FOREIGN_EMPLOYEE_DENIED");
  assert.equal(state.runs.length, 3, "THREE_FICTIONAL_RUNS_EXACTLY");
  assert.equal(state.entries.length, 18, "EIGHTEEN_DETAIL_ROWS_EXACTLY");
  for (const spec of FIXTURES) {
    const r = state.runs.find(x => x.id === spec.id);
    assert.ok(r, "ORIGINAL_RUN_ID_CHANGED");
    assert.equal(r.organization_id, state.orgs[0].id, "RUN_TENANT_CHANGED");
    assert.equal(r.period_label, spec.label, "PERIOD_LABEL_CHANGED");
    assert.equal(r.period_start, spec.start, "PERIOD_START_CHANGED");
    assert.equal(r.period_end, spec.end, "PERIOD_END_CHANGED");
    assert.equal(r.pay_date, spec.paid, "PAY_DATE_CHANGED");
    assert.equal(r.status, spec.status, "HISTORIC_RUN_STATUS_CHANGED");
    assert.equal(r.employee_count, 6, "EMPLOYEE_COUNT_CHANGED");
    assert.equal(r.gross, stage === "correct" ? spec.correctGross : spec.oldGross,
      "EXPECTED_GROSS_HEADER_DRIFT");
    assert.equal(r.net, stage === "correct" ? spec.correctNet : spec.oldNet,
      "EXPECTED_NET_HEADER_DRIFT");
    const lines = state.entries.filter(x => x.payroll_run_id === spec.id);
    assert.equal(lines.length, 6, "DETAIL_COUNT_MUST_BE_SIX");
    assert.equal(new Set(lines.map(x => x.employee_id)).size, 6,
      "UNIQUE_DETAIL_WORKERS_REQUIRED");
    assert.ok(lines.every(x => x.employee_org_id === r.organization_id),
      "CROSS_ORGANIZATION_DETAIL_DENIED");
    let totalGross = 0n;
    let totalNet = 0n;
    for (const x of lines) {
      const gross = centavos(x.gross);
      const deducted = centavos(x.deductions);
      const net = centavos(x.net);
      assert.equal(gross - deducted, net, "DETAIL_GROSS_MINUS_DEDUCTIONS_MISMATCH");
      totalGross += gross;
      totalNet += net;
    }
    assert.equal(totalGross, centavos(spec.correctGross), "DETAIL_GROSS_REFERENCE_DRIFT");
    assert.equal(totalNet, centavos(spec.correctNet), "DETAIL_NET_REFERENCE_DRIFT");
  }
  await countLinkedEvidence(client);
  return state;
}

async function nonHeaderFingerprint(client) {
  // No content or personally identifying fields are written into CI logs.
  // Only a local SHA of complete fictional rows is retained in memory.
  const tableNames = [
    "organizations", "employees", "payroll_entries", "audit_events",
    "approval_tasks", "payroll_jobs", "payslips", "bank_file_validations",
    "government_filing_validations", "managed_payroll_run_approvals",
  ];
  const hash = createHash("sha256");
  for (const name of tableNames) {
    const rows = (await client.query(
      "SELECT row_to_json(t) AS payload FROM public." + name + " t ORDER BY id"
    )).rows;
    hash.update(name);
    hash.update(JSON.stringify(rows));
  }
  return hash.digest("hex");
}

async function changeThreeHeaders(client, direction, commit = true) {
  const from = direction === "forward" ? "old" : "correct";
  const to = direction === "forward" ? "correct" : "old";
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const locked = (await client.query(
      "SELECT id FROM public.payroll_runs WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
      [FIXTURES.map(x => x.id)]
    )).rows;
    assert.deepEqual(locked.map(x => x.id), [1,2,3], "EXACT_THREE_LOCKED_RUNS_REQUIRED");
    // All 18 detail rows locked against concurrent edits for this transaction.
    const detailsLocked = (await client.query(
      "SELECT id FROM public.payroll_entries WHERE payroll_run_id=ANY($1::int[]) ORDER BY id FOR SHARE",
      [FIXTURES.map(x => x.id)]
    )).rows;
    assert.equal(detailsLocked.length, 18);
    const before = await inspect(client, from);
    const orgId = before.orgs[0].id;
    let changed = 0;
    for (const spec of FIXTURES) {
      const beforeGross = from === "old" ? spec.oldGross : spec.correctGross;
      const beforeNet = from === "old" ? spec.oldNet : spec.correctNet;
      const afterGross = to === "old" ? spec.oldGross : spec.correctGross;
      const afterNet = to === "old" ? spec.oldNet : spec.correctNet;
      const changedRun = await client.query([
        "UPDATE public.payroll_runs SET gross_pay=$1::numeric,net_pay=$2::numeric",
        "WHERE id=$3 AND organization_id=$4 AND period_label=$5",
        "AND period_start=$6::date AND period_end=$7::date AND pay_date=$8::date",
        "AND status=$9 AND employee_count=6",
        "AND gross_pay=$10::numeric AND net_pay=$11::numeric",
        "RETURNING id",
      ].join(" "), [
        afterGross, afterNet, spec.id, orgId, spec.label,
        spec.start, spec.end, spec.paid, spec.status, beforeGross, beforeNet,
      ]);
      assert.equal(changedRun.rowCount, 1, "COMPARE_AND_SWAP_DENIED");
      changed += changedRun.rowCount;
      await client.query([
        "INSERT INTO pg_temp.issue1102_rehearsal_receipts",
        "(run_id,direction,before_gross,before_net,after_gross,after_net)",
        "VALUES ($1,$2,$3::numeric,$4::numeric,$5::numeric,$6::numeric)",
      ].join(" "), [
        spec.id, direction, beforeGross, beforeNet, afterGross, afterNet,
      ]);
    }
    assert.equal(changed, 3, "EXACTLY_THREE_HEADERS_ONLY");
    await inspect(client, to);
    if (commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    return changed;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

async function expectPreflightRefusal(client, sql, params, code) {
  await client.query("BEGIN");
  try {
    await client.query(sql, params);
    await assert.rejects(() => inspect(client, "old"), new RegExp(code));
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  const connectionString = requireDisposableAction();
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await checkEmptyFixture(client);
    const actualOrg = await ensurePublicDemoTenant();
    assert.equal(typeof actualOrg, "number");
    const sourceState = await inspect(client, "correct");
    assert.equal(actualOrg, sourceState.orgs[0].id);

    // Recreate only the historically incorrect HEADER values, and only
    // inside a throwaway CI database with real Drizzle-created public tables.
    await client.query("BEGIN");
    try {
      for (const spec of FIXTURES) {
        const update = await client.query([
          "UPDATE public.payroll_runs SET gross_pay=$1,net_pay=$2",
          "WHERE id=$3 AND organization_id=$4 AND status=$5",
          "AND gross_pay=$6 AND net_pay=$7 RETURNING id",
        ].join(" "), [
          spec.oldGross, spec.oldNet, spec.id, actualOrg, spec.status,
          spec.correctGross, spec.correctNet,
        ]);
        assert.equal(update.rowCount, 1, "LEGACY_FIXTURE_PREPARATION_GUARD_FAILED");
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }

    await client.query([
      "CREATE TEMP TABLE issue1102_rehearsal_receipts",
      "(run_id integer NOT NULL, direction text NOT NULL,",
      "before_gross numeric(18,2) NOT NULL,before_net numeric(18,2) NOT NULL,",
      "after_gross numeric(18,2) NOT NULL,after_net numeric(18,2) NOT NULL)",
      "ON COMMIT PRESERVE ROWS",
    ].join(" "));

    const baseline = await inspect(client, "old");
    const baselineFingerprint = await nonHeaderFingerprint(client);
    await expectPreflightRefusal(client,
      "UPDATE public.payroll_runs SET gross_pay=0 WHERE id=1", [],
      "EXPECTED_GROSS_HEADER_DRIFT");
    await expectPreflightRefusal(client,
      "UPDATE public.payroll_runs SET status='Wrong' WHERE id=1", [],
      "HISTORIC_RUN_STATUS_CHANGED");
    await expectPreflightRefusal(client,
      "UPDATE public.payroll_entries SET deductions=0 WHERE id=(SELECT MIN(id) FROM public.payroll_entries WHERE payroll_run_id=2)",
      [], "DETAIL_GROSS_MINUS_DEDUCTIONS_MISMATCH");
    await expectPreflightRefusal(client,
      "DELETE FROM public.payroll_entries WHERE id=(SELECT MIN(id) FROM public.payroll_entries WHERE payroll_run_id=3)",
      [], "EIGHTEEN_DETAIL_ROWS_EXACTLY");
    await expectPreflightRefusal(client,
      "UPDATE public.organizations SET name='Wrong fictional organization' WHERE id=$1",
      [actualOrg], "WRONG_FICTIONAL_ORGANIZATION");
    assert.deepEqual(await readState(client), baseline, "NEGATIVE_CASES_MUST_ROLL_BACK");

    // First prove transaction ROLLBACK restores every old header.
    assert.equal(await changeThreeHeaders(client, "forward", false), 3);
    assert.deepEqual(await readState(client), baseline, "ROLLBACK_MUST_PRESERVE_OLD_HEADERS");

    // Then commit the correction ON THE THROWAWAY DATABASE and prove
    // the independently guarded reversal restores the initial state.
    assert.equal(await changeThreeHeaders(client, "forward", true), 3);
    await inspect(client, "correct");
    assert.equal(await nonHeaderFingerprint(client), baselineFingerprint,
      "NON_HEADER_DATA_CHANGED_ON_FORWARD_REPAIR");
    await assert.rejects(() => changeThreeHeaders(client, "forward", true),
      /EXPECTED_GROSS_HEADER_DRIFT/, "FORWARD_REPLAY_MUST_FAIL_CLOSED");
    await inspect(client, "correct");

    assert.equal(await changeThreeHeaders(client, "reverse", true), 3);
    assert.deepEqual(await readState(client), baseline, "REVERSAL_MUST_RESTORE_ORIGINAL_HEADERS");
    assert.equal(await nonHeaderFingerprint(client), baselineFingerprint,
      "NON_HEADER_DATA_CHANGED_ON_REVERSAL");
    await assert.rejects(() => changeThreeHeaders(client, "reverse", true),
      /EXPECTED_GROSS_HEADER_DRIFT/, "REVERSE_REPLAY_MUST_FAIL_CLOSED");

    const { rows: receipts } = await client.query(
      "SELECT run_id,direction,before_gross::text,after_gross::text FROM pg_temp.issue1102_rehearsal_receipts ORDER BY direction,run_id"
    );
    assert.equal(receipts.length, 6, "TWO_DIRECTIONS_THREE_HEADERS_EACH");
    assert.equal(receipts.filter(x => x.direction === "forward").length, 3);
    assert.equal(receipts.filter(x => x.direction === "reverse").length, 3);
    console.log(JSON.stringify({
      result: "PASS",
      scope: "DISPOSABLE_GITHUB_POSTGRES_ACTUAL_PUBLIC_SCHEMA",
      source: "repository db:push plus ensurePublicDemoTenant",
      fictionalOrganizations: 1, fictionalEmployees: 8,
      historicRuns: 3, detailRows: 18, perRunDetails: 6,
      rejectedAdversarialPreflights: 5,
      rollbackTransactionPassed: true,
      correctionCommittedOnDisposableOnly: true,
      guardedReversalCommittedOnDisposableOnly: true,
      forwardAndReverseReplayDenied: true,
      originalHeaderValuesRestored: true,
      detailAndAuditFingerprintsUnchanged: true,
      originalNeonRowsChanged: false,
      authorizedToApplyLive: false,
      realEmployerAcceptance: false,
    }));
  } finally {
    await client.end();
    await pool.end();
  }
}

main().catch(error => {
  console.error("ISSUE1102_PUBLIC_SCHEMA_REHEARSAL_FAILED: " +
    (error instanceof Error ? error.message : "unknown"));
  process.exitCode = 1;
});
