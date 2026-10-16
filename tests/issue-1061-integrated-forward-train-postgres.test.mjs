import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";
import { ISSUE1054_PREFLIGHT_SQL, ISSUE1054_POSTFLIGHT_SQL } from "../scripts/lib/issue-1054-protected-preflight.mjs";

/**
 * P0-4 / #1061: one exact-source 0115 -> 0123 integration rehearsal.
 *
 * A separate, empty GitHub Actions Postgres 16/18 service is REQUIRED.
 * No Neon, Vercel, employer database or production credentials are accepted.
 * All fictional rows, DDL, backfill and DROP statements are inside a single
 * transaction that is ALWAYS rolled back, including when an assertion fails.
 *
 * A green test is NOT a historical applied migration receipt, current
 * production parity, independent DBA approval or payroll-release permission.
 */
const TRAIN = Object.freeze([
  "0115_payout_profiles_foundation.sql",
  "0116_payout_ledger_foundation.sql",
  "0117_inline_first_payroll_journey.sql",
  "0118_wfm_roster_scale_rules.sql",
  "0119_xendit_payout_provider.sql",
  "0120_wfm_punch_evidence.sql",
  "0121_multi_entity_v2_scope_transfer.sql",
  "0122_tenant_module_disclosure.sql",
  "0123_multi_entity_forward_schema_repair.sql",
]);
const MISSING_FOUNDATION = Object.freeze([
  "payout_batch_transfers", "payout_transfers",
  "payout_batches", "payout_profiles",
]);
const MISSING_0123 = Object.freeze([
  "provider_events",
  "workforce_demand_import_batches",
  "workforce_demand_observation_revisions",
  "workforce_demand_forecast_issues",
  "workforce_demand_forecast_scores",
  "workforce_demand_staffing_policies",
  "workforce_demand_staffing_policy_events",
]);
const ENTITY_TABLES = Object.freeze([
  "entity_transfer_requests", "employee_entity_assignments",
  "user_entity_preferences", "user_legal_entity_grants",
]);
// Production evidence reports ALL six compensation targets absent, including
// compensation_events. Do not let db:push's dev-only table mask this difference.
const MISSING_RECOVERY = Object.freeze([
  "attendance_exception_events", "employee_availability_rules", "open_shifts",
  "open_shift_claims", "compensation_bands", "compensation_cycles",
  "compensation_proposals", "compensation_components",
  "employee_compensation_components", "compensation_events",
]);
const FORWARD_RECOVERY = Object.freeze([
  "0124_attendance_exception_forward_repair.sql",
  "0125_wfm_availability_open_shifts_forward_repair.sql",
  "0126_compensation_governance_forward_repair.sql",
]);
const RECONCILIATION = "0128_recovery_foreign_key_names_forward.sql";
const READY = process.env.CI === "true"
  && process.env.GITHUB_ACTIONS === "true"
  && process.env.PENDING_TRAIN_REHEARSAL_MODE === "isolated-ci-only";

function source(name) {
  return readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8");
}

async function fingerprint(db) {
  const { rows: [row] } = await db.query(
    "SELECT " +
    "(SELECT md5(coalesce(string_agg(c.relname || ':' || c.relkind::text, '|' " +
      "ORDER BY c.relname,c.relkind::text),'')) " +
      "FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace " +
      "AND c.relkind IN ('r','p','v','m','i','S')) AS relations, " +
    "(SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' || " +
      "pg_catalog.format_type(a.atttypid,a.atttypmod), '|' " +
      "ORDER BY c.relname,a.attname),'')) " +
      "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid " +
      "WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m') " +
      "AND a.attnum>0 AND NOT a.attisdropped) AS columns, " +
    "(SELECT md5(coalesce(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':' || " +
      "pg_catalog.pg_get_constraintdef(c.oid), '|' " +
      "ORDER BY c.conrelid::regclass::text,c.conname),'')) " +
      "FROM pg_catalog.pg_constraint c WHERE c.connamespace='public'::regnamespace) AS constraints, " +
    "(SELECT md5(coalesce(string_agg(indexname || ':' || indexdef, '|' ORDER BY indexname),'')) " +
      "FROM pg_catalog.pg_indexes WHERE schemaname='public') AS indexes, " +
    "(SELECT md5(coalesce(string_agg(p.proname || '(' || " +
      "pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' || " +
      "pg_catalog.pg_get_functiondef(p.oid), '|' ORDER BY p.proname, " +
      "pg_catalog.pg_get_function_identity_arguments(p.oid)),'')) " +
      "FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace) AS functions, " +
    "(SELECT md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || " +
      "pg_catalog.pg_get_triggerdef(t.oid), '|' ORDER BY c.relname,t.tgname),'')) " +
      "FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid " +
      "WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) AS triggers"
  );
  return row;
}

async function money(db) {
  const { rows: [row] } = await db.query(
    "SELECT (SELECT count(*)::integer FROM public.employees) AS workers," +
    "(SELECT count(*)::integer FROM public.payroll_runs) AS runs," +
    "(SELECT count(*)::integer FROM public.payroll_entries) AS entries," +
    "(SELECT coalesce(sum(gross_pay),0)::numeric(20,2)::text " +
      "FROM public.payroll_entries) AS gross," +
    "(SELECT coalesce(sum(deductions),0)::numeric(20,2)::text " +
      "FROM public.payroll_entries) AS deductions," +
    "(SELECT coalesce(sum(net_pay),0)::numeric(20,2)::text " +
      "FROM public.payroll_entries) AS net"
  );
  return row;
}

async function mustDeny(db, sql, params, code = "23503") {
  await db.query("SAVEPOINT denied_entity_write");
  try {
    await assert.rejects(() => db.query(sql, params),
      error => error.code === code, "must reject cross-tenant/employer write (" + code + ")");
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT denied_entity_write");
    await db.query("RELEASE SAVEPOINT denied_entity_write");
  }
}

async function exists(db, tableName) {
  const { rows: [row] } = await db.query(
    "SELECT to_regclass($1) IS NOT NULL AS present", ["public." + tableName]
  );
  return row.present;
}

test("exact nine sources are pinned by content; only 0121 performs historical DML", () => {
  assert.equal(TRAIN.length, 9);
  assert.equal(new Set(TRAIN).size, 9);
  const sha = TRAIN.map(name => {
    const sql = source(name);
    assert.ok(sql.length > 200, "truncated source: " + name);
    assert.doesNotMatch(sql.replace(/--[^\r\n]*/g, ""),
      /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im,
      "migration runner, never source SQL, owns the transaction");
    return name + ":" + createHash("sha256").update(sql, "utf8").digest("hex");
  });
  const backfill = source(TRAIN[6]).replace(/--[^\r\n]*/g, "");
  assert.match(backfill, /\bUPDATE\s+payroll_entries\b/i);
  assert.match(backfill, /\bINSERT\s+INTO\s+employee_entity_assignments\b/i);
  const forward = source(TRAIN[8]).replace(/--[^\r\n]*/g, "");
  assert.doesNotMatch(forward, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE)\b/i,
    "0123 may not silently assign historical employers or mutate worker/payroll rows");
  console.log("SOURCE_ONLY_SHA256 (not an applied journal receipt)\n" + sha.join("\n"));
});

test("PG16/18: 0115-0123 exact source, denied writes, money invariants and total ROLLBACK", {
  skip: !READY, timeout: 180000,
}, async () => {
  const url = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: process.env.PENDING_TRAIN_REHEARSAL_MODE,
  });
  for (const name of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "MULTI_ENTITY_ENABLED", "MULTI_ENTITY_TRANSFERS_ENABLED",
    "WFM_PUNCH_EVIDENCE_ENABLED",
  ]) assert.equal(process.env[name], "false", name + " must remain disabled in CI");

  const db = new pg.Client({
    connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 140000,
  });
  await db.connect();
  let inTransaction = false;
  try {
    const catalogBefore = await fingerprint(db);
    const moneyBefore = await money(db);
    await db.query("BEGIN");
    inTransaction = true;
    await db.query("SET LOCAL statement_timeout = '120s'");
    // Synthetic db:push has current schema. Remove ONLY these disposable
    // objects within this transaction so exact source files must rebuild them.
    const toRemove = [...MISSING_FOUNDATION, ...MISSING_0123, ...ENTITY_TABLES, ...MISSING_RECOVERY];
    await db.query("DROP TABLE IF EXISTS " +
      toRemove.map(name => 'public."' + name + '"').join(", ") + " CASCADE");
    for (const table of toRemove) assert.equal(await exists(db, table), false, table);

    // 0123 must be atomic and fail closed until 0115/0116 payout foundations.
    const afterDrop = await fingerprint(db);
    await db.query("SAVEPOINT missing_payout");
    await assert.rejects(() => db.query(source(TRAIN[8])),
      error => error.code === "P0001" &&
        error.message.includes("ISSUE910_MISSING_SCHEMA_PREREQUISITES"),
      "0123 must not bypass the payout foundations");
    await db.query("ROLLBACK TO SAVEPOINT missing_payout");
    await db.query("RELEASE SAVEPOINT missing_payout");
    assert.deepEqual(await fingerprint(db), afterDrop,
      "failure before payout foundations must not change any catalog object");

    const [tenantA, tenantB] = (await db.query(
      "INSERT INTO organizations(name,legal_name) VALUES " +
      "('1061 fictional tenant A','1061 fictional tenant A')," +
      "('1061 fictional tenant B','1061 fictional tenant B') RETURNING id"
    )).rows.map(r => r.id);
    const [historicalEntity, currentEntity, unrelatedEntity] = (await db.query(
      "INSERT INTO legal_entities(organization_id,code,legal_name,display_name,primary_entity)" +
      " VALUES ($1,'A1','A1','A1',true),($1,'A2','A2','A2',false)," +
      "($2,'B1','B1','B1',true) RETURNING id", [tenantA, tenantB]
    )).rows.map(r => r.id);
    const [userA, userB] = (await db.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES " +
      "('Synthetic HR A','issue1061-train-a@example.test','fictional','hr')," +
      "('Synthetic HR B','issue1061-train-b@example.test','fictional','hr') RETURNING id"
    )).rows.map(r => r.id);
    await db.query("INSERT INTO user_organizations(organization_id,user_id,role)" +
      " VALUES($1,$2,'hr'),($3,$4,'hr')", [tenantA, userA, tenantB, userB]);
    const [workerA, workerB] = (await db.query(
      "INSERT INTO employees(organization_id,legal_entity_id,employee_no," +
      "first_name,last_name,title,avatar_initials,basic_rate,start_date) VALUES " +
      "($1,$2,'FA-1','Fictional','WorkerA','Staff','FA',10000.00,'2026-01-01')," +
      "($3,$4,'FB-1','Fictional','WorkerB','Staff','FB',12000.00,'2026-01-01') RETURNING id",
      [tenantA, currentEntity, tenantB, unrelatedEntity]
    )).rows.map(r => r.id);
    // Crucial regression: CURRENT employee entity A2, HISTORICAL run entity A1.
    const runA = (await db.query(
      "INSERT INTO payroll_runs(organization_id,legal_entity_id,period_label," +
      "period_start,period_end,pay_date) VALUES " +
      "($1,$2,'Historical A1','2026-09-01','2026-09-15','2026-09-15') RETURNING id",
      [tenantA, historicalEntity]
    )).rows[0].id;
    const entryA = (await db.query(
      "INSERT INTO payroll_entries(payroll_run_id,employee_id,gross_pay,deductions,net_pay)" +
      " VALUES($1,$2,9999.99,1234.56,8765.43) RETURNING id",
      [runA, workerA]
    )).rows[0].id;
    const seededMoney = await money(db);
    // db:push can omit the optional 0122 module preference columns.
    // In that legacy state the migration must backfill "all" for existing
    // tenants while setting "core" only as the default for future inserts.
    const navigationColumnPresent = (await db.query(
      "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a " +
      "WHERE a.attrelid='public.organizations'::regclass " +
      "AND a.attname='module_navigation_mode' AND a.attnum>0 " +
      "AND NOT a.attisdropped) AS present"
    )).rows[0].present;
    const originalNavigation = navigationColumnPresent
      ? (await db.query(
          "SELECT module_navigation_mode FROM organizations WHERE id=$1", [tenantA]
        )).rows[0].module_navigation_mode
      : "all";

    for (const name of TRAIN) {
      await db.query(source(name));
      if (name.startsWith("0116")) {
        for (const payout of MISSING_FOUNDATION)
          assert.equal(await exists(db, payout), true, payout);
      }
      if (name.startsWith("0121")) {
        const history = (await db.query(
          "SELECT legal_entity_id FROM payroll_entries WHERE id=$1", [entryA]
        )).rows[0].legal_entity_id;
        assert.equal(history, historicalEntity,
          "backfill must use the immutable parent run, NEVER current worker employer");
        const inferred = (await db.query(
          "SELECT count(*)::integer AS n FROM employee_entity_assignments " +
          "WHERE organization_id=$1 AND employee_id=$2", [tenantA, workerA]
        )).rows[0].n;
        assert.equal(inferred, 0,
          "conflicting prior run must block inferred employee entity assignment");
        assert.deepEqual(await money(db), seededMoney,
          "0115-0121 must not alter any payroll centavo");
      }
    }
    assert.equal((await db.query(
      "SELECT module_navigation_mode FROM organizations WHERE id=$1", [tenantA]
    )).rows[0].module_navigation_mode, originalNavigation,
    "0122 must preserve existing employer navigation");
    for (const name of [...MISSING_FOUNDATION, ...MISSING_0123, ...ENTITY_TABLES])
      assert.equal(await exists(db, name), true, "post-train missing " + name);
    const provider = (await db.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint " +
      "WHERE conrelid='public.payout_batches'::regclass " +
      "AND conname='payout_batches_provider_check'"
    )).rows;
    assert.equal(provider.length, 1);
    assert.match(provider[0].def, /xendit/i);
    for (const fk of [
      "employees_tenant_employer_fk", "payroll_runs_tenant_employer_fk",
      "assignment_employee_tenant_fk", "payroll_entries_run_employer_fk",
    ]) {
      const result = await db.query(
        "SELECT convalidated FROM pg_constraint WHERE conname=$1", [fk]
      );
      assert.equal(result.rows.length, 1, "missing 0123 scope FK: " + fk);
      assert.equal(result.rows[0].convalidated, false,
        "historic unreviewed employer links must remain NOT VALID: " + fk);
    }
    await mustDeny(db,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)" +
      " VALUES($1,$2,$3)", [tenantA, userA, unrelatedEntity]);
    await mustDeny(db,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)" +
      " VALUES($1,$2,$3)", [tenantA, userB, historicalEntity]);
    await mustDeny(db,
      "INSERT INTO employee_entity_assignments(organization_id,employee_id," +
      "legal_entity_id,effective_from) VALUES($1,$2,$3,'2026-10-01')",
      [tenantA, workerB, historicalEntity]);
    await mustDeny(db,
      "INSERT INTO employee_entity_assignments(organization_id,employee_id," +
      "legal_entity_id,effective_from) VALUES($1,$2,$3,'2026-10-01')",
      [tenantA, workerA, unrelatedEntity]);
    await mustDeny(db,
      "UPDATE payroll_runs SET legal_entity_id=$1 WHERE id=$2",
      [unrelatedEntity, runA]);
    await mustDeny(db,
      "UPDATE payroll_entries SET legal_entity_id=$1 WHERE id=$2",
      [currentEntity, entryA]);

    assert.equal((await db.query(
      "SELECT legal_entity_id FROM payroll_entries WHERE id=$1", [entryA]
    )).rows[0].legal_entity_id, historicalEntity);
    const afterFullTrain = await money(db);
    assert.deepEqual(afterFullTrain, seededMoney,
      "0122/0123 must preserve counts, gross, deductions and net exactly");
    await db.query(source(TRAIN[8]));
    assert.deepEqual(await money(db), seededMoney,
      "idempotent 0123 must never alter fictional payroll values");

    // Same transaction, actual sources: 0115-0123 -> 0124 -> 0125 -> 0126.
    // The ten targets must be wholly absent *before* the forward-only repairs.
    const { generateSchemaManifest } = await import("../scripts/lib/issue-1031-schema-manifest.ts");
    const manifest = generateSchemaManifest();
    const targetNames = new Set(MISSING_RECOVERY);
    const targetModels = manifest.tables.filter(t => targetNames.has(t.name));
    assert.equal(targetModels.length, 10, "production-shaped model missing recovery targets");
    for (const table of targetModels) {
      assert.equal(await exists(db, table.name), false, "dev-only target leaked " + table.name);
      assert.equal((await db.query("SELECT to_regclass($1) AS object", [
        "public." + table.name + "_id_seq"])).rows[0].object, null,
      "orphan sequence leaked from Drizzle fixture " + table.name);
      for (const idx of table.indexes) {
        assert.equal((await db.query("SELECT to_regclass($1) AS object", [
          "public." + idx.name])).rows[0].object, null,
        "orphan recovery index leaked " + idx.name);
      }
    }
    for (const name of FORWARD_RECOVERY) {
      const sql = source(name);
      assert.doesNotMatch(sql.replace(/--[^\r\n]*/g, ""),
        /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im,
        "release runner must own the one transaction");
      if (name === FORWARD_RECOVERY[1]) await db.query(ISSUE1054_PREFLIGHT_SQL);
      await db.query(sql);
      if (name === FORWARD_RECOVERY[1]) await db.query(ISSUE1054_POSTFLIGHT_SQL);
    }
    for (const name of MISSING_RECOVERY)
      assert.equal(await exists(db, name), true, "forward repair missing " + name);
    assert.deepEqual(await money(db), seededMoney,
      "0124-0126 must not change worker or historical payroll centavos");

    // Preserve the exact #1031 raw intermediate report: historical 0124/0125/
    // 0126 use PG-generated FK names. Do not conceal their legitimate name drift.
    const { fullSchemaCatalogSql } = await import("../scripts/check-issue-1031-full-schema-diff.ts");
    const { diffSchema } = await import("../src/lib/issue-1031-full-schema-diff.ts");
    const names = targetNames;
    const tables = targetModels;
    const compareRecovery = async (stage) => {
      const rows = (await db.query(fullSchemaCatalogSql)).rows
        .filter(r => names.has(r.table_name))
        .map(({ table_name, kind, object_name, details }) =>
          ({ table_name, kind, object_name, ...details }));
      const compared = diffSchema({ ...manifest, tables }, rows);
      const statusByTable = Object.fromEntries(MISSING_RECOVERY.map(table => [table,
        Object.fromEntries(["PASS","MISSING","DRIFT","EXTRA"].map(status =>
          [status,compared.filter(r => r.table===table && r.status===status).length]))
      ]));
      console.log(JSON.stringify({ stage, evidence: "SYNTHETIC_ROLLBACK_ONLY",
        orderedFiles: [...TRAIN,...FORWARD_RECOVERY,...(stage==="POST_0128" ? [RECONCILIATION] : [])],
        statusByTable, productionReceipt:false,
        results: compared.map(({ table,kind,object,status }) =>
          ({table,kind,object,status})) }));
      return compared;
    };
    const beforeRename = await compareRecovery("POST_0126_PRE_0128");
    const oldNames = beforeRename.filter(x => x.kind==="foreign_key" &&
      (x.status==="MISSING" || x.status==="EXTRA"));
    assert.equal(oldNames.length, 98, "expected full historical FK-name drift before 0128");
    assert.ok(beforeRename.some(x => x.status !== "PASS"), "cannot mask historical FK naming drift");

    // 0127 already exists in the Drizzle bootstrap and is outside the ten
    // recovery targets. Its genuine release receipt must be independently
    // reviewed before anyone plans this new sequential 0128 migration.
    await db.query(source(RECONCILIATION));
    const compared = await compareRecovery("POST_0128");
    const failures = compared.filter(r => r.status !== "PASS");
    assert.equal(failures.length, 0,
      "#1031 post-reconciliation MISSING/DRIFT/EXTRA: " + JSON.stringify(failures));
    assert.ok(compared.length > 160, "target manifest unexpectedly empty or truncated");

    // Replayed forward migrations must refuse the existing target, leaving
    // the same catalog (SAVEPOINT ROLLBACK) and unchanged payroll cents.
    for (const [name, code] of [
      [FORWARD_RECOVERY[0], "ISSUE1015_EXISTING_ATTENDANCE_RELATION_REQUIRES_MANUAL_REVIEW"],
      [FORWARD_RECOVERY[1], "ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION"],
      [FORWARD_RECOVERY[2], "COMP1061_PARTIAL_OR_EXISTING_COMPENSATION_SCHEMA"],
    ]) {
      await db.query("SAVEPOINT forward_replay");
      try {
        await assert.rejects(
          () => db.query(name === FORWARD_RECOVERY[1] ? ISSUE1054_PREFLIGHT_SQL : source(name)), err =>
          err.code === "P0001" && err.message.includes(code), name + " must fail closed");
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT forward_replay");
        await db.query("RELEASE SAVEPOINT forward_replay");
      }
    }
    await db.query("SAVEPOINT issue1121_0128_replay");
    try {
      await assert.rejects(() => db.query(source(RECONCILIATION)),
        err => err.code === "P0001" &&
          err.message.includes("ISSUE1121_TARGET_FK_NAME_ALREADY_PRESENT"));
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT issue1121_0128_replay");
      await db.query("RELEASE SAVEPOINT issue1121_0128_replay");
    }
    assert.deepEqual(await money(db), seededMoney,
      "negative replay tests must not change fictional payroll cents");

    await db.query("ROLLBACK");
    inTransaction = false;
    assert.deepEqual(await fingerprint(db), catalogBefore,
      "rollback must restore tables, columns, indexes, constraints, functions and triggers");
    assert.deepEqual(await money(db), moneyBefore,
      "rollback must restore pre-test employee/payroll counts and cents");
  } finally {
    if (inTransaction) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
});
