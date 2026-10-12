import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { inventoryMigrationSources } from "../scripts/lib/migration-receipt-audit.mjs";
import { REQUIRED_MODERN_SCHEMA_COLUMNS } from "../scripts/lib/schema-lineage-preflight.mjs";
import {
  cutoverSourceManifest, evaluateReviewedMigration, loadReviewedSql,
  runReviewedMigrationOnClient,
} from "../scripts/lib/reviewed-migration-runner.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "payrollph-forward-migration-"));
  writeFileSync(join(directory, "0021_legacy_a.sql"), "CREATE TABLE historical_a(id int);\n");
  writeFileSync(join(directory, "0021_legacy_b.sql"), "CREATE TABLE historical_b(id int);\n");
  writeFileSync(join(directory, "0022_forward.sql"), "CREATE TABLE isolated_forward_fixture(id integer PRIMARY KEY);\n");
  writeFileSync(join(directory, "0023_followup.sql"), "ALTER TABLE isolated_forward_fixture ADD COLUMN marker text;\n");
  const inventory = inventoryMigrationSources(directory);
  const historic = cutoverSourceManifest(inventory, 21);
  const cutover = {
    historicalPrefix: 21,
    historicalManifestSha256: historic.digest,
    evidenceRef: "DBA-CUTOVER-2026-01",
    reviewedBy: "Independent DBA",
    reviewedAt: new Date("2026-10-12T00:00:00Z"),
  };
  const receipts = historic.files.map(file => ({
    migrationPath: file.path,
    sha256: file.sha256,
    disposition: "applied",
    evidenceRef: "DBA-HIST-2026-001",
    reviewedBy: "Independent DBA",
    recordedAt: new Date("2026-10-12T00:00:00Z"),
  }));
  const target = inventory.files.find(file => file.path === "drizzle/0022_forward.sql");
  return { directory, inventory, cutover, receipts, target, applied: [] };
}
function review(f, over = {}) {
  return evaluateReviewedMigration({
    inventory: f.inventory, cutover: f.cutover, receipts: f.receipts,
    applied: f.applied, requestedPath: f.target.path, expectedSha256: f.target.sha256,
    ...over,
  });
}
function recorded(file, extra = {}) {
  return {
    migrationPath: file.path,
    migrationNumber: Number(file.prefix),
    sourceSha256: file.sha256,
    appliedBy: "reviewed-operator",
    changeRef: "DBA-CHANGE-2026-001",
    appliedAt: new Date("2026-10-12T00:00:00Z"),
    ...extra,
  };
}
const TEST_NEON_IDENTITY = Object.freeze({
  projectId: "calm-wave-70219564",
  branchId: "br-lucky-sound-b79i56jw",
  endpointId: "ep-cool-hat-b7e7gpoo",
});

test("flag-off apply fails before any SQL, including isolated-role bypass", async () => {
  for (const raw of [undefined, "", "false", "TRUE", "1", " true"] ) {
    let queries = 0;
    await assert.rejects(() => runReviewedMigrationOnClient({
      mode: "apply", allowElevatedRoleForIsolatedTest: true,
      releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: raw },
      client: { async query() { queries++; throw new Error("must not connect"); } },
    }), /REVIEWED_MIGRATION_FLAG_DISABLED/);
    assert.equal(queries, 0);
  }
  const result = spawnSync(process.execPath, ["scripts/run-reviewed-migration.mjs",
    "--apply", "--file", "drizzle/0115_synthetic.sql", "--sha256", "a".repeat(64)], {
    encoding: "utf8", env: { ...process.env, ORDERED_RELEASE_MIGRATIONS_ENABLED: "false" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REVIEWED_MIGRATION_FLAG_DISABLED/);
});

test("historical adoption refuses receipts outside the explicit baseline", () => {
  const f = fixture();
  try {
    assert.throws(() => review(f, { receipts: [...f.receipts, {
      ...f.receipts[0], migrationPath: f.target.path, sha256: f.target.sha256,
    }] }), /HISTORICAL_RECEIPT_OUTSIDE_BASELINE/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("ordinary backslashes cannot hide a COMMIT when standard strings are on", () => {
  const f = fixture();
  try {
    const path = join(f.directory, "0022_forward.sql");
    writeFileSync(path, "SELECT '\\'; COMMIT; SELECT 'tail';\n");
    const changed = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
    assert.throws(() => loadReviewedSql(f.directory, changed), /SQL_REQUIRES_NONTRANSACTIONAL_OR_MANUAL_REVIEW/);
    writeFileSync(path, "SELECT E'it\\'s quoted; COMMIT;';\n");
    const safe = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
    assert.doesNotThrow(() => loadReviewedSql(f.directory, safe));
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

function fakeClient(f, opts = {}) {
  const calls = [];
  const state = { applied: [...(opts.applied ?? [])], throwDuringSql: Boolean(opts.throwDuringSql) };
  return {
    calls, state,
    async query(sql, args = []) {
      calls.push(sql);
      if (sql.includes('AS "databaseName"')) return { rows: [{
        databaseName: "app_db",
        neonProjectId: TEST_NEON_IDENTITY.projectId,
        neonBranchId: TEST_NEON_IDENTITY.branchId,
        neonEndpointId: TEST_NEON_IDENTITY.endpointId,
        readOnly: calls.some(line => line.includes("READ ONLY")),
        inRecovery: false,
        elevated: false,
        hasWritePrivileges: false,
        canReadSensitiveRows: false,
        ...(opts.identity ?? {}),
      }] };
      if (sql.includes('AS "matchesExpectedType"')) return { rows:
        REQUIRED_MODERN_SCHEMA_COLUMNS.map(([tableName, columnName]) => ({
          tableName, columnName, matchesExpectedType: !opts.legacyLineage,
        })),
      };
      if (sql.includes('AS "receipts"')) return { rows: [{
        receipts: true, cutover: true, journal: true,
      }] };
      if (sql.includes('AS "pathPrimaryKey"')) return { rows: [{
        pathPrimaryKey: true, numberUnique: true, cutoverPrimaryKey: true,
        ...(opts.constraints ?? {}),
      }] };
      if (sql.includes("FROM public.payrollph_migration_cutover")) return { rows: [f.cutover] };
      if (sql.includes("FROM public.payrollph_release_migration_receipts")) return { rows: f.receipts };
      if (sql.includes("FROM public.payrollph_schema_migrations")) return { rows: state.applied };
      if (sql.startsWith("INSERT INTO public.payrollph_schema_migrations")) {
        state.applied.push(recorded(f.target, {
          migrationPath: args[0], migrationNumber: args[1], sourceSha256: args[2],
          appliedBy: args[3], changeRef: args[4],
        }));
      }
      if (sql === "CREATE TABLE isolated_forward_fixture(id integer PRIMARY KEY);\n" &&
          state.throwDuringSql) throw new Error("synthetic statement failure");
      return { rows: [] };
    },
  };
}

test("full paths, not duplicate historic number prefixes, identify reviewed adoption", () => {
  const f = fixture();
  try {
    assert.equal(f.receipts.length, 2);
    assert.equal(cutoverSourceManifest(f.inventory, 21).duplicatePrefixes.length, 1);
    const plan = review(f);
    assert.equal(plan.status, "ready");
    assert.equal(plan.migrationNumber, 22);
    assert.equal(plan.historicReceiptsVerified, 2);
    assert.equal(plan.productionReleaseApproved, false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("missing, inaccurate and unreviewed historical receipts cannot authorize a forward migration", () => {
  const f = fixture();
  try {
    assert.throws(() => review(f, { receipts: f.receipts.slice(1) }), /HISTORICAL_RECEIPTS_UNRECONCILED/);
    assert.throws(() => review(f, {
      receipts: [{ ...f.receipts[0], sha256: "0".repeat(64) }, f.receipts[1]],
    }), /HISTORICAL_RECEIPTS_UNRECONCILED/);
    assert.throws(() => review(f, {
      receipts: [{ ...f.receipts[0], disposition: "not-applied" }, f.receipts[1]],
    }), /HISTORICAL_RECEIPTS_UNRECONCILED/);
    assert.throws(() => review(f, { cutover: {
      ...f.cutover, historicalManifestSha256: "f".repeat(64),
    } }), /CUTOVER_EVIDENCE_OR_HASH_MISMATCH/);
    assert.throws(() => review(f, { cutover: {
      ...f.cutover, reviewedBy: "",
    } }), /CUTOVER_EVIDENCE_OR_HASH_MISMATCH/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("applied migration cannot rerun; source or journal drift fails closed", () => {
  const f = fixture();
  try {
    assert.equal(review(f, { applied: [recorded(f.target)] }).status, "already-applied");
    assert.throws(() => review(f, { applied: [recorded(f.target, {
      sourceSha256: "f".repeat(64),
    })] }), /JOURNAL_DRIFT_OR_OUT_OF_ORDER/);
    assert.throws(() => review(f, { applied: [recorded(f.target), recorded(f.target)] }),
      /JOURNAL_DRIFT_OR_OUT_OF_ORDER/);
    assert.throws(() => review(f, { expectedSha256: "f".repeat(64) }),
      /SOURCE_SHA_OR_PATH_MISMATCH/);
    assert.throws(() => review(f, { requestedPath: "../drizzle/baseline.sql" }),
      /REQUEST_INVALID/);
    const followup = f.inventory.files.find(file => file.path === "drizzle/0023_followup.sql");
    assert.throws(() => review(f, {
      requestedPath: followup.path, expectedSha256: followup.sha256,
    }), /PREVIOUS_MIGRATION_MISSING/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("new forward prefix gaps or collisions are never implicitly ordered", () => {
  const f = fixture();
  try {
    const without22 = { ...f.inventory, files: f.inventory.files.filter(row => row.path !== f.target.path) };
    assert.throws(() => review(f, { inventory: without22 }), /NEW_PREFIX_GAP_OR_DUPLICATE/);
    const duplicate = { ...f.inventory, files: [...f.inventory.files, {
      path: "drizzle/0022_other.sql", prefix: "0022", sha256: f.target.sha256,
    }] };
    assert.throws(() => review(f, { inventory: duplicate }), /NEW_PREFIX_GAP_OR_DUPLICATE/);
    const next = f.inventory.files.find(row => row.path === "drizzle/0023_followup.sql");
    assert.equal(review(f, { applied: [recorded(f.target)], requestedPath: next.path,
      expectedSha256: next.sha256 }).status, "ready");
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("exact-byte checks reject changed SQL and transaction or journal escapes", () => {
  const f = fixture();
  try {
    assert.match(loadReviewedSql(f.directory, f.target), /CREATE TABLE isolated_forward_fixture/);
    writeFileSync(join(f.directory, "0022_forward.sql"), "COMMIT;\nDROP TABLE employees;\n");
    assert.throws(() => loadReviewedSql(f.directory, f.target), /SQL_CHANGED_AFTER_PLAN/);
    writeFileSync(join(f.directory, "0022_forward.sql"), "COMMIT;\n");
    const updated = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
    assert.throws(() => loadReviewedSql(f.directory, updated), /SQL_REQUIRES_NONTRANSACTIONAL_OR_MANUAL_REVIEW/);
    writeFileSync(join(f.directory, "0022_forward.sql"), "ALTER TABLE payrollph_schema_migrations DROP COLUMN source_sha256;");
    const journal = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
    assert.throws(() => loadReviewedSql(f.directory, journal), /SQL_REQUIRES_NONTRANSACTIONAL_OR_MANUAL_REVIEW/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("plan uses READ ONLY/rollback and never executes SQL or inserts receipts", async () => {
  const f = fixture();
  try {
    const db = fakeClient(f);
    const result = await runReviewedMigrationOnClient({
      client: db, inventory: f.inventory, sourceDirectory: f.directory,
      mode: "plan", requestedPath: f.target.path, expectedSha256: f.target.sha256,
      expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.sqlApplied, false);
    assert.ok(db.calls[0].includes("READ ONLY"));
    assert.equal(db.calls.at(-1), "ROLLBACK");
    assert.equal(db.calls.some(line => line.includes("INSERT INTO")), false);
    assert.equal(db.calls.includes("CREATE TABLE isolated_forward_fixture(id integer PRIMARY KEY);\n"), false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("apply locks, records once, commits; reentry sees already applied and cannot submit twice", async () => {
  const f = fixture();
  try {
    const db = fakeClient(f);
    const args = {
      client: db, inventory: f.inventory, sourceDirectory: f.directory,
      releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" },
      mode: "apply", requestedPath: f.target.path, expectedSha256: f.target.sha256,
      expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
      operator: "reviewed-operator", approvalRef: "DBA-CHANGE-2026-001",
    };
    const first = await runReviewedMigrationOnClient(args);
    const second = await runReviewedMigrationOnClient(args);
    assert.equal(first.sqlApplied, true);
    assert.equal(second.status, "already-applied");
    assert.equal(second.sqlApplied, false);
    assert.equal(db.state.applied.length, 1);
    assert.equal(db.calls.filter(line => line.includes("pg_advisory_xact_lock")).length, 2);
    assert.equal(db.calls.filter(line => line === "CREATE TABLE isolated_forward_fixture(id integer PRIMARY KEY);\n").length, 1);
    assert.equal(db.calls.filter(line => line === "COMMIT").length, 2);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("SQL failure rolls back without writing an application receipt", async () => {
  const f = fixture();
  try {
    const db = fakeClient(f, { throwDuringSql: true });
    await assert.rejects(runReviewedMigrationOnClient({
      client: db, inventory: f.inventory, sourceDirectory: f.directory,
      releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" },
      mode: "apply", requestedPath: f.target.path, expectedSha256: f.target.sha256,
      expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
      operator: "reviewed-operator", approvalRef: "DBA-CHANGE-2026-001",
    }), /synthetic statement failure/);
    assert.equal(db.state.applied.length, 0);
    assert.equal(db.calls.at(-1), "ROLLBACK");
    assert.equal(db.calls.includes("COMMIT"), false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("SQL parser preserves dollar-quoted routines but forbids transaction escape after comments", () => {
  const f = fixture();
  try {
    const path = join(f.directory, "0022_forward.sql");
    writeFileSync(path, "-- COMMIT appears in comment only\nDO $$ BEGIN PERFORM 1; END $$;\n");
    let changed = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
    assert.match(loadReviewedSql(f.directory, changed), /PERFORM 1/);
    for (const sql of [
      "SELECT 'COMMIT' AS harmless; /* ignored */ COMMIT;",
      "SELECT 1; -- reviewed\nROLLBACK;",
      "SET statement_timeout = '0';",
      "CREATE INDEX CONCURRENTLY anything_idx ON table_name(id);",
      "SELECT 1; /* nested /* comment */ still comment */ COMMIT;",
      "DO $$ BEGIN PERFORM 1; END $$;\nSAVEPOINT escape;",
      "SELECT $$ unterminated;"
    ]) {
      writeFileSync(path, sql);
      changed = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
      assert.throws(() => loadReviewedSql(f.directory, changed), /REVIEWED_MIGRATION_SQL_/);
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("plan rejects overprivileged audit accounts and mismatched target databases", async () => {
  const f = fixture();
  try {
    const base = {
      inventory: f.inventory, sourceDirectory: f.directory,
      mode: "plan", requestedPath: f.target.path,
      expectedSha256: f.target.sha256, expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
    };
    for (const identity of [
      { hasWritePrivileges: true },
      { canReadSensitiveRows: true },
      { elevated: true },
      { databaseName: "wrong_database" },
    ]) {
      await assert.rejects(
        runReviewedMigrationOnClient({ ...base, client: fakeClient(f, { identity }) }),
        /DATABASE_ROLE_OR_IDENTITY_REJECTED/,
      );
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("missing uniqueness or primary-key constraints block even a read-only plan", async () => {
  const f = fixture();
  try {
    for (const constraints of [
      { pathPrimaryKey: false }, { numberUnique: false }, { cutoverPrimaryKey: false },
    ]) {
      await assert.rejects(() => runReviewedMigrationOnClient({
        client: fakeClient(f, { constraints }),
        inventory: f.inventory, sourceDirectory: f.directory,
        mode: "plan", requestedPath: f.target.path,
        expectedSha256: f.target.sha256, expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
      }), /LEDGER_CONSTRAINTS_MISSING/);
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("P0-4 live Neon legacy lineage cannot be treated as a numbered migration baseline", async () => {
  const f = fixture();
  try {
    const db = fakeClient(f, { legacyLineage: true });
    await assert.rejects(() => runReviewedMigrationOnClient({
      client: db, inventory: f.inventory, sourceDirectory: f.directory,
      releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" },
      mode: "apply", requestedPath: f.target.path, expectedSha256: f.target.sha256,
      expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY, operator: "reviewed-operator",
      approvalRef: "DBA-CHANGE-2026-001",
    }), /REVIEWED_MIGRATION_LEGACY_SCHEMA_INCOMPATIBLE/);
    assert.ok(db.calls.some(sql => sql.includes('AS "matchesExpectedType"')),
      "must inspect PostgreSQL catalogs for modern integer IDs");
    assert.ok(!db.calls.some(sql => sql.startsWith("INSERT INTO")));
    assert.equal(db.state.applied.length, 0);
    assert.equal(db.calls.at(-1), "ROLLBACK");
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});


test("normal UPDATE ... SET is accepted as transactional DML but session SET is blocked", () => {
  const f = fixture();
  try {
    const path = join(f.directory, "0022_forward.sql");
    const statements = [
      "UPDATE payroll_entries SET status = 'draft' WHERE id = 1;",
      "WITH x AS (SELECT 1) UPDATE payroll_entries SET status = 'draft' WHERE id = 1;",
      "CREATE OR REPLACE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE x SET y=2; END $$;",
    ];
    for (const sql of statements) {
      writeFileSync(path, sql + "\n");
      const source = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
      assert.equal(loadReviewedSql(f.directory, source), sql + "\n");
    }
    for (const sql of [
      "SET search_path = public;",
      "UPDATE payroll_entries SET status = 'draft'; COMMIT;",
      "START TRANSACTION; UPDATE payroll_entries SET status = 'draft';",
      "REINDEX TABLE example;",
      "DROP INDEX CONCURRENTLY example;",
    ]) {
      writeFileSync(path, sql + "\n");
      const source = inventoryMigrationSources(f.directory).files.find(file => file.path === f.target.path);
      assert.throws(() => loadReviewedSql(f.directory, source),
        /SQL_REQUIRES_NONTRANSACTIONAL_OR_MANUAL_REVIEW/);
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("reviewed SQL file reader refuses a symlink even if it points to a valid file", () => {
  const f = fixture();
  try {
    const path = join(f.directory, "0022_forward.sql");
    // Open a link to another source file, which would have passed a later
    // read if an attacker replaced the path between lstat and read.
    unlinkSync(path);
    symlinkSync(join(f.directory, "0023_followup.sql"), path);
    const candidate = {
      path: "drizzle/0022_forward.sql",
      sha256: f.inventory.files.find(x => x.path === "drizzle/0023_followup.sql").sha256,
    };
    assert.throws(() => loadReviewedSql(f.directory, candidate));
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});


test("wrong Neon project, branch or endpoint is rejected before inspecting migration ledger", async () => {
  const f = fixture();
  try {
    const inputs = {
      inventory: f.inventory, sourceDirectory: f.directory,
      releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" },
      mode: "apply", requestedPath: f.target.path, expectedSha256: f.target.sha256,
      expectedDatabaseName: "app_db", expectedNeonIdentity: TEST_NEON_IDENTITY,
      operator: "synthetic-operator", approvalRef: "SYNTHETIC-CHANGE-001",
    };
    for (const change of [
      { neonProjectId: "wrong-project" },
      { neonBranchId: "br-snapshot-test" },
      { neonEndpointId: "ep-snapshot-endpoint" },
      { neonBranchId: null },
    ]) {
      const fake = fakeClient(f, { identity: change });
      await assert.rejects(runReviewedMigrationOnClient({ ...inputs, client: fake }),
        /DATABASE_ROLE_OR_IDENTITY_REJECTED/);
      assert.equal(fake.state.applied.length, 0);
      assert.equal(fake.calls.at(-1), "ROLLBACK");
      assert.equal(fake.calls.some(sql => sql.includes("FROM public.payrollph_migration_cutover")), false);
    }
    await assert.rejects(runReviewedMigrationOnClient({
      ...inputs, client: fakeClient(f), expectedNeonIdentity: null,
    }), /NEON_TARGET_PIN_REQUIRED/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
