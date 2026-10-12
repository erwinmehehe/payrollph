import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";
import { inventoryMigrationSources } from "../scripts/lib/migration-receipt-audit.mjs";
import { assertModernSchemaLineage } from "../scripts/lib/schema-lineage-preflight.mjs";
import { cutoverSourceManifest, runReviewedMigrationOnClient } from "../scripts/lib/reviewed-migration-runner.mjs";

const ONLY_ISOLATED = process.env.MIGRATION_REHEARSAL_MODE === "isolated-ci-only";

test("Postgres 16: verified baseline, read-only preview, concurrent one-time commit, atomic SQL rollback", {
  skip: !ONLY_ISOLATED,
  timeout: 120000,
}, async () => {
  // This must run before constructing any database client. The only allowed
  // target is an unshared disposable localhost:5432/app_db CI service.
  const url = assertIsolatedMigrationTarget(process.env);
  const dir = mkdtempSync(join(tmpdir(), "payrollph-reviewed-pg-"));
  const pastA = "0021_historic_a.sql";
  const pastB = "0021_historic_b.sql";
  const next = "0022_forward.sql";
  const broken = "0023_failure.sql";
  writeFileSync(join(dir, pastA), "CREATE TABLE reviewed_historic_a(id int);\n");
  writeFileSync(join(dir, pastB), "CREATE TABLE reviewed_historic_b(id int);\n");
  writeFileSync(join(dir, next),
    "CREATE TABLE public.synthetic_forward_once(id integer PRIMARY KEY, organization_id integer NOT NULL);\n" +
    "INSERT INTO public.synthetic_forward_once(id, organization_id) VALUES (1, 101);\n");
  writeFileSync(join(dir, broken),
    "CREATE TABLE public.synthetic_forward_must_rollback(id integer PRIMARY KEY);\n" +
    "SELECT 1/0;\n");
  const inventory = inventoryMigrationSources(dir);
  const historic = cutoverSourceManifest(inventory, 21);
  const current = inventory.files.find(f => f.path === "drizzle/" + next);
  const failing = inventory.files.find(f => f.path === "drizzle/" + broken);
  const admin = new pg.Client({ connectionString: url });
  const one = new pg.Client({ connectionString: url });
  const two = new pg.Client({ connectionString: url });
  try {
    await admin.connect();
    await assert.rejects(() => assertModernSchemaLineage(admin),
      /REVIEWED_MIGRATION_LEGACY_SCHEMA_INCOMPATIBLE/,
      "a blank/non-modern database must not receive a forward migration");
    // Disposable identity-only schema fixtures; no employee or payroll rows.
    // The production legacy schema uses UUID/client_id and must fail instead.
    for (const sql of [
      "CREATE TABLE public.organizations (id integer PRIMARY KEY)",
      "CREATE TABLE public.employees (id integer PRIMARY KEY, organization_id integer NOT NULL)",
      "CREATE TABLE public.payroll_runs (id integer PRIMARY KEY, organization_id integer NOT NULL)",
      "CREATE TABLE public.payroll_entries (id integer PRIMARY KEY, payroll_run_id integer NOT NULL)",
      "CREATE TABLE public.payout_transfers (id integer PRIMARY KEY)",
      "CREATE TABLE public.provider_events (id integer PRIMARY KEY)",
    ]) await admin.query(sql);
    await assert.doesNotReject(() => assertModernSchemaLineage(admin));
    await admin.query(readFileSync("docs/engineering/production-migration-receipt-journal-template.sql", "utf8"));
    await admin.query(readFileSync("docs/engineering/reviewed-migration-cutover-template.sql", "utf8"));
    for (const file of historic.files) {
      await admin.query(
        "INSERT INTO public.payrollph_release_migration_receipts " +
        "(migration_path, source_sha256, disposition, evidence_ref, reviewed_by) " +
        "VALUES ($1, $2, 'applied', 'SYNTHETIC-DBA-REVIEW', 'independent-ci-reviewer')",
        [file.path, file.sha256],
      );
    }
    await admin.query(
      "INSERT INTO public.payrollph_migration_cutover " +
      "(id, historical_prefix, historical_manifest_sha256, evidence_ref, reviewed_by, reviewed_at) " +
      "VALUES (1, 21, $1, 'SYNTHETIC-CUTOVER-CHANGE', 'independent-ci-reviewer', now())",
      [historic.digest],
    );
    await one.connect();
    await two.connect();
    const args = {
      inventory, sourceDirectory: dir, expectedDatabaseName: "app_db",
      requestedPath: current.path, expectedSha256: current.sha256,
      operator: "synthetic-operator", approvalRef: "SYNTHETIC-APPROVED-CHANGE",
      allowElevatedRoleForIsolatedTest: true,
    };
    const preview = await runReviewedMigrationOnClient({ ...args, client: one, mode: "plan" });
    assert.equal(preview.status, "ready");
    assert.equal(preview.sqlApplied, false);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.payrollph_schema_migrations")).rows[0].count, 0);
    assert.equal((await admin.query("SELECT to_regclass('public.synthetic_forward_once') AS name")).rows[0].name, null);

    const [first, second] = await Promise.all([
      runReviewedMigrationOnClient({ ...args, client: one, mode: "apply" }),
      runReviewedMigrationOnClient({ ...args, client: two, mode: "apply" }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), ["already-applied", "ready"]);
    assert.equal([first.sqlApplied, second.sqlApplied].filter(Boolean).length, 1);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.payrollph_schema_migrations")).rows[0].count, 1);
    assert.deepEqual((await admin.query("SELECT id, organization_id FROM public.synthetic_forward_once")).rows,
      [{ id: 1, organization_id: 101 }]);
    const replay = await runReviewedMigrationOnClient({ ...args, client: one, mode: "apply" });
    assert.equal(replay.status, "already-applied");
    assert.equal(replay.sqlApplied, false);

    await assert.rejects(() => runReviewedMigrationOnClient({
      ...args, client: one, mode: "apply",
      requestedPath: failing.path, expectedSha256: failing.sha256,
    }), /division by zero/);
    assert.equal((await admin.query(
      "SELECT to_regclass('public.synthetic_forward_must_rollback') AS name",
    )).rows[0].name, null);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.payrollph_schema_migrations")).rows[0].count, 1);

    // SQL tampering cannot pass a check against the original committed path
    // even if every previously-applied row still exists.
    await admin.query("UPDATE public.payrollph_schema_migrations SET source_sha256 = $1 WHERE migration_path = $2",
      ["f".repeat(64), current.path]);
    await assert.rejects(() => runReviewedMigrationOnClient({
      ...args, client: one, mode: "plan",
    }), /JOURNAL_DRIFT_OR_OUT_OF_ORDER/);
  } finally {
    for (const client of [one, two]) {
      try { await client.end(); } catch { /* disposable service */ }
    }
    try {
      await admin.query("DROP TABLE IF EXISTS public.synthetic_forward_must_rollback");
      await admin.query("DROP TABLE IF EXISTS public.synthetic_forward_once");
      await admin.query("DROP TABLE IF EXISTS public.payrollph_schema_migrations");
      await admin.query("DROP TABLE IF EXISTS public.payrollph_migration_cutover");
      await admin.query("DROP TABLE IF EXISTS public.payrollph_release_migration_receipts");
      await admin.query("DROP TABLE IF EXISTS public.provider_events");
      await admin.query("DROP TABLE IF EXISTS public.payout_transfers");
      await admin.query("DROP TABLE IF EXISTS public.payroll_entries");
      await admin.query("DROP TABLE IF EXISTS public.payroll_runs");
      await admin.query("DROP TABLE IF EXISTS public.employees");
      await admin.query("DROP TABLE IF EXISTS public.organizations");
    } catch { /* disposable DB discarded on workflow exit */ }
    try { await admin.end(); } catch { /* disposable DB */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
