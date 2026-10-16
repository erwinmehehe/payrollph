import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inventoryMigrationSources } from "../scripts/lib/migration-receipt-audit.mjs";
import { HISTORICAL_REQUIRED_OBJECTS } from "../scripts/lib/historical-catalog-gate.mjs";
import { REQUIRED_MODERN_SCHEMA_COLUMNS } from "../scripts/lib/schema-lineage-preflight.mjs";
import {
  cutoverSourceManifest, runReviewedMigrationOnClient,
} from "../scripts/lib/reviewed-migration-runner.mjs";
import {
  ISSUE1054_MIGRATION_PATH, ISSUE1054_PREFLIGHT_SQL, ISSUE1054_POSTFLIGHT_SQL,
} from "../scripts/lib/issue-1054-protected-preflight.mjs";

// These are fake, in-memory catalog/ledger responses. The separate PG16/18
// rehearsal exercises real catalog effects on disposable localhost databases.
const IDENTITY = Object.freeze({
  projectId: "synthetic-project-1054",
  branchId: "br-synthetic-1054",
  endpointId: "ep-synthetic-1054",
});
const WHEN = new Date("2026-10-16T00:00:00.000Z");
const ORIGINAL_SQL = readFileSync(
  new URL("../drizzle/0125_wfm_availability_open_shifts_forward_repair.sql", import.meta.url), "utf8",
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "payrollph-issue-1054-protected-"));
  writeFileSync(join(directory, "0124_synthetic_historical.sql"), "SELECT 1;\n");
  writeFileSync(join(directory, "0125_wfm_availability_open_shifts_forward_repair.sql"), ORIGINAL_SQL);
  const inventory = inventoryMigrationSources(directory);
  const historic = cutoverSourceManifest(inventory, 124);
  const previous = historic.files[0];
  const target = inventory.files.find(x => x.path === ISSUE1054_MIGRATION_PATH);
  assert.ok(target, "reviewed 0125 must be present");
  return {
    directory, inventory, target,
    cutover: {
      historicalPrefix: 124,
      historicalManifestSha256: historic.digest,
      evidenceRef: "SYNTHETIC-DBA-HISTORY-1054",
      reviewedBy: "Synthetic Test DBA",
      reviewedAt: WHEN,
    },
    receipts: [{
      migrationPath: previous.path, sha256: previous.sha256,
      disposition: "applied", evidenceRef: "SYNTHETIC-DBA-HISTORY-1054",
      reviewedBy: "Synthetic Test DBA", recordedAt: WHEN,
    }],
  };
}

async function withFixture(callback) {
  const f = fixture();
  try { return await callback(f); }
  finally { rmSync(f.directory, { recursive: true, force: true }); }
}

function recorded(target) {
  return {
    migrationPath: target.path, migrationNumber: Number(target.prefix),
    sourceSha256: target.sha256, appliedBy: "Synthetic Operator",
    changeRef: "SYNTHETIC-APPROVAL-1054", appliedAt: WHEN,
  };
}

function client(f, { failAt, alreadyApplied = false } = {}) {
  const calls = [];
  const applied = alreadyApplied ? [recorded(f.target)] : [];
  return {
    calls, applied,
    async query(sql, args = []) {
      calls.push(sql);
      if (sql.includes('AS "databaseName"')) return { rows: [{
        databaseName: "app_db", neonProjectId: IDENTITY.projectId,
        neonBranchId: IDENTITY.branchId, neonEndpointId: IDENTITY.endpointId,
        readOnly: calls[0].includes("READ ONLY"), inRecovery: false,
        elevated: false, hasWritePrivileges: false, canReadSensitiveRows: false,
      }] };
      if (sql.includes('AS "matchesExpectedType"')) return { rows:
        REQUIRED_MODERN_SCHEMA_COLUMNS.map(([tableName, columnName]) => ({
          tableName, columnName, matchesExpectedType: true,
        })),
      };
      if (sql.includes('AS "matches"')) return { rows:
        HISTORICAL_REQUIRED_OBJECTS.map(item => ({ key: item.key, matches: true })),
      };
      if (sql.includes('AS "receipts"')) return { rows: [{
        receipts: true, cutover: true, journal: true,
      }] };
      if (sql.includes('AS "pathPrimaryKey"')) return { rows: [{
        pathPrimaryKey: true, numberUnique: true, cutoverPrimaryKey: true,
      }] };
      if (sql.includes("FROM public.payrollph_migration_cutover")) {
        return { rows: [f.cutover] };
      }
      if (sql.includes("FROM public.payrollph_release_migration_receipts")) {
        return { rows: f.receipts };
      }
      if (sql.includes("FROM public.payrollph_schema_migrations")) {
        return { rows: applied };
      }
      if (sql === ISSUE1054_PREFLIGHT_SQL && failAt === "preflight") {
        throw Object.assign(new Error("ISSUE1054_ORPHANED_INDEX_OR_SEQUENCE"), { code: "P0001" });
      }
      if (sql === ISSUE1054_POSTFLIGHT_SQL && failAt === "postflight") {
        throw Object.assign(new Error("ISSUE1054_POSTFLIGHT_INCOMPLETE_FINAL_SCHEMA"), { code: "P0001" });
      }
      if (sql.startsWith("INSERT INTO public.payrollph_schema_migrations")) {
        applied.push({
          ...recorded(f.target), migrationPath: args[0], migrationNumber: args[1],
          sourceSha256: args[2], appliedBy: args[3], changeRef: args[4],
        });
      }
      return { rows: [] };
    },
  };
}

function run(f, db, mode) {
  return runReviewedMigrationOnClient({
    client: db, inventory: f.inventory, sourceDirectory: f.directory,
    mode, requestedPath: f.target.path, expectedSha256: f.target.sha256,
    expectedDatabaseName: "app_db", expectedNeonIdentity: IDENTITY,
    releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" },
    operator: "Synthetic Operator", approvalRef: "SYNTHETIC-APPROVAL-1054",
  });
}

test("#1054 protected PLAN checks preflight in read-only transaction, without applying DDL", async () =>
  withFixture(async f => {
    const db = client(f);
    const result = await run(f, db, "plan");
    assert.equal(result.status, "ready");
    assert.equal(result.sqlApplied, false);
    assert.match(db.calls[0], /READ ONLY/);
    assert.ok(db.calls.includes(ISSUE1054_PREFLIGHT_SQL));
    assert.ok(!db.calls.includes(ISSUE1054_POSTFLIGHT_SQL));
    assert.ok(!db.calls.includes(ORIGINAL_SQL));
    assert.ok(!db.calls.some(sql => sql.startsWith("INSERT INTO")));
    assert.equal(db.calls.at(-1), "ROLLBACK");
  }));

test("#1054 protected APPLY orders preflight, immutable DDL, postflight, receipt, COMMIT", async () =>
  withFixture(async f => {
    const db = client(f);
    const result = await run(f, db, "apply");
    const order = [
      ISSUE1054_PREFLIGHT_SQL, ORIGINAL_SQL, ISSUE1054_POSTFLIGHT_SQL,
    ].map(sql => db.calls.indexOf(sql));
    const receipt = db.calls.findIndex(sql =>
      sql.startsWith("INSERT INTO public.payrollph_schema_migrations"));
    assert.ok(order.every(x => x >= 0), "all three SQL phases must execute");
    assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < receipt);
    assert.equal(db.calls.at(-1), "COMMIT");
    assert.equal(result.sqlApplied, true);
    assert.deepEqual(db.applied, [recorded(f.target)]);
  }));

for (const failAt of ["preflight", "postflight"]) {
  test("#1054 protected " + failAt + " failure rolls back without a receipt", async () =>
    withFixture(async f => {
      const db = client(f, { failAt });
      await assert.rejects(() => run(f, db, "apply"), error =>
        error?.code === "P0001" && error.message.startsWith("ISSUE1054_"));
      assert.equal(db.calls.at(-1), "ROLLBACK");
      assert.ok(!db.calls.includes("COMMIT"));
      assert.equal(db.applied.length, 0, "a failed migration cannot record an apply receipt");
      assert.equal(db.calls.includes(ORIGINAL_SQL), failAt === "postflight",
        "preflight must reject before DDL and postflight after it");
    }));
}

test("#1054 recorded migration reentry skips DDL and both companion guards", async () =>
  withFixture(async f => {
    const db = client(f, { alreadyApplied: true });
    const result = await run(f, db, "apply");
    assert.equal(result.status, "already-applied");
    assert.equal(result.sqlApplied, false);
    assert.ok(!db.calls.includes(ISSUE1054_PREFLIGHT_SQL));
    assert.ok(!db.calls.includes(ISSUE1054_POSTFLIGHT_SQL));
    assert.ok(!db.calls.includes(ORIGINAL_SQL));
    assert.ok(!db.calls.some(sql => sql.startsWith("INSERT INTO")));
    assert.equal(db.calls.at(-1), "COMMIT");
    assert.equal(db.applied.length, 1);
  }));
