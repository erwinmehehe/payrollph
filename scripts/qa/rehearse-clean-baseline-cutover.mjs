#!/usr/bin/env node
// Rehearses the clean-baseline recovery cutover on a DISPOSABLE localhost
// PostgreSQL only. Never point this at Neon or any shared database.
//
// Precondition: database "neondb" on 127.0.0.1:5432 was just built as
//   drizzle push of schema.ts + drizzle/0109 + docs/sql/source-baseline-supplement.sql
// Steps (same order and shared code as the production runner, scripts/lib/clean-baseline-cutover.mjs):
//   1. provision roles (the operator's step; here with random passwords)
//   2. drizzle/0133-equivalent v2 audit guards (review-only companion, bound in memory)
//   3. least-privilege ownership and grants
//   4. migration-control ledgers with a 'baseline-included' receipt per numbered file, and the cutover row
//   5. every reviewed-runner gate as the planner; plan + apply of a probe migration
//      as the migrator (needs O_NOFOLLOW, i.e. Linux)
//   6. audit sealing through the dedicated sealer; legacy sealing must now fail
// Credentials are random per run, exist only in this process, and are never printed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { constants, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { inventoryMigrationSources } from "../lib/migration-receipt-audit.mjs";
import { evaluateReviewedMigration, runReviewedMigrationOnClient } from "../lib/reviewed-migration-runner.mjs";
import { assertModernSchemaLineage } from "../lib/schema-lineage-preflight.mjs";
import { assertHistoricalCatalog } from "../lib/historical-catalog-gate.mjs";
import { assertMigrationControlLedgerCatalog } from "../lib/reviewed-migration-control-ledger.mjs";
import { missingMigrationObjects, objectKey } from "../lib/migration-only-objects.mjs";
import { LOGIN_ROLES, applyOwnershipAndGrants, assertCutoverRolesProvisioned, createLedgersAndCutover, grantSealerMembership, installV2AuditGuards } from "../lib/clean-baseline-cutover.mjs";

const HOST = "127.0.0.1:5432";
const DB = "neondb";
const ADMIN_URL = `postgresql://postgres:postgres@${HOST}/${DB}`;
const FICTIONAL_BRANCH = "br-rehearsal-cutover";
const PROJECT = "calm-wave-70219564";
const roleUrl = (role, password) => `postgresql://${role}:${password}@${HOST}/${DB}`;
const evidence = "rehearsal-" + new Date().toISOString().slice(0, 10) + "-clean-baseline";
const results = [];
const step = async (name, fn) => {
  try { const detail = await fn(); results.push({ step: name, ok: true, ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ step: name, ok: false, error: String(error?.message ?? error).split("\n")[0].slice(0, 200) }); throw error; }
};

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const q = (sql, params) => admin.query(sql, params);
const passwords = new Map();
const inventory = inventoryMigrationSources("drizzle");
const throughPrefix = Math.max(...inventory.files.map((f) => Number(f.prefix)));

try {
  await step("precondition: disposable, empty, push + 0109 + supplement", async () => {
    const { rows: [s] } = await q(`SELECT current_database() db,
      (SELECT count(*)::int FROM organizations) orgs, (SELECT count(*)::int FROM audit_events) audits,
      (SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'payrollph\\_%') roles`);
    assert.equal(s.db, DB);
    // ADMIN_URL is fixed to 127.0.0.1; in CI the server sees its container IP, so do not check inet_server_addr().
    assert.equal(s.orgs, 0); assert.equal(s.audits, 0);
    assert.equal(s.roles, 0, "rehearsal roles must not exist yet (fresh server or cleaned up)");
    const { missing } = await missingMigrationObjects(admin);
    const keys = missing.map(objectKey);
    assert.ok(keys.every((k) => k.includes("_v2")), "only the deferred 0133 v2 guards may be missing: " + keys.join(","));
    return { missingBeforeV2: keys.length };
  });

  await step("1. provision roles (operator step; passwords only in this process)", async () => {
    for (const name of LOGIN_ROLES) passwords.set(name, randomBytes(24).toString("hex"));
    await q(`CREATE ROLE payrollph_schema_owner NOLOGIN NOINHERIT;
      CREATE ROLE payrollph_ledger_owner NOLOGIN NOINHERIT;
      CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
    for (const name of LOGIN_ROLES) {
      await q(`CREATE ROLE ${name} LOGIN ${name === "payrollph_migrator" ? "INHERIT" : "NOINHERIT"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get(name)}'`);
    }
    await assertCutoverRolesProvisioned(q);
  });

  await step("2. v2 audit guards (0133-equivalent companion, bound in memory)", async () => {
    await q("BEGIN");
    try {
      await installV2AuditGuards(q, { branchId: FICTIONAL_BRANCH, databaseName: DB, isolatedTestIdentity: { projectId: PROJECT } });
      await q("COMMIT");
    } catch (error) { await q("ROLLBACK"); throw error; }
  });

  await step("3. ownership and least-privilege grants", async () => applyOwnershipAndGrants(q, { databaseName: DB, bootstrapOwner: "postgres" }));

  await step("4. migration-control ledgers, receipts and cutover row", async () => {
    const detail = await createLedgersAndCutover(q, { evidenceRef: evidence + " source-first baseline", reviewedBy: "rehearsal operator (fictional)" });
    await grantSealerMembership(q);
    const { missing } = await missingMigrationObjects(admin);
    assert.deepEqual(missing.map(objectKey), [], "every migration-created object is now present");
    return detail;
  });

  // Synthetic forward migration in a temporary copy of drizzle/.
  const source = mkdtempSync(join(tmpdir(), "cutover-rehearsal-"));
  for (const f of readdirSync("drizzle")) if (f.endsWith(".sql")) cpSync(join("drizzle", f), join(source, f));
  const probeName = `${String(throughPrefix + 1).padStart(4, "0")}_rehearsal_probe.sql`;
  writeFileSync(join(source, probeName), "CREATE TABLE public.rehearsal_probe (id integer PRIMARY KEY, note text NOT NULL);\n");
  const probeInventory = inventoryMigrationSources(source);
  const probe = probeInventory.files.find((f) => f.path === "drizzle/" + probeName);
  const nofollow = Number.isInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW !== 0;

  const planner = new pg.Client({ connectionString: roleUrl("payrollph_migration_planner", passwords.get("payrollph_migration_planner")) });
  await planner.connect();
  try {
    await step("5a. planner: lineage, historical catalog and ledger gates", async () => {
      await planner.query("BEGIN READ ONLY");
      try {
        await assertModernSchemaLineage(planner);
        await assertHistoricalCatalog(planner, throughPrefix);
        await assertMigrationControlLedgerCatalog(planner);
      } finally { await planner.query("ROLLBACK"); }
    });
    await step("5b. planner: decision for the probe migration", async () => {
      const cutover = (await planner.query(`SELECT historical_prefix AS "historicalPrefix", historical_manifest_sha256 AS "historicalManifestSha256",
        evidence_ref AS "evidenceRef", reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt" FROM public.payrollph_migration_cutover`)).rows[0];
      const receipts = (await planner.query(`SELECT migration_path AS "migrationPath", source_sha256 AS sha256, disposition,
        evidence_ref AS "evidenceRef", reviewed_by AS "reviewedBy", recorded_at AS "recordedAt" FROM public.payrollph_release_migration_receipts`)).rows;
      const decision = evaluateReviewedMigration({ inventory: probeInventory, cutover, receipts, applied: [], requestedPath: probe.path, expectedSha256: probe.sha256 });
      assert.equal(decision.status, "ready");
      return { status: decision.status, historicReceiptsVerified: decision.historicReceiptsVerified };
    });
    if (nofollow) {
      await step("5c. planner: full runner plan (read-only)", async () => {
        const r = await runReviewedMigrationOnClient({ client: planner, inventory: probeInventory, sourceDirectory: source, mode: "plan",
          requestedPath: probe.path, expectedSha256: probe.sha256, expectedDatabaseName: DB, allowElevatedRoleForIsolatedTest: true });
        assert.equal(r.status, "ready"); assert.equal(r.sqlApplied, false);
      });
    }
  } finally { await planner.end(); }

  if (nofollow) {
    const migrator = new pg.Client({ connectionString: roleUrl("payrollph_migrator", passwords.get("payrollph_migrator")) });
    await migrator.connect();
    try {
      await step("5d. migrator: apply probe, then re-apply is a no-op", async () => {
        const args = { client: migrator, inventory: probeInventory, sourceDirectory: source, requestedPath: probe.path, expectedSha256: probe.sha256,
          expectedDatabaseName: DB, allowElevatedRoleForIsolatedTest: true, operator: "rehearsal operator (fictional)", approvalRef: evidence + " probe",
          releaseEnvironment: { ORDERED_RELEASE_MIGRATIONS_ENABLED: "true" } };
        const first = await runReviewedMigrationOnClient({ ...args, mode: "apply" });
        assert.equal(first.sqlApplied, true);
        const second = await runReviewedMigrationOnClient({ ...args, mode: "apply" });
        assert.equal(second.status, "already-applied"); assert.equal(second.sqlApplied, false);
        const { rows } = await q("SELECT migration_path, applied_by FROM public.payrollph_schema_migrations");
        assert.equal(rows.length, 1);
        assert.equal((await q("SELECT to_regclass('public.rehearsal_probe')::text AS t")).rows[0].t, "rehearsal_probe");
        assert.equal((await q("SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE oid='public.rehearsal_probe'::regclass")).rows[0].o, "payrollph_schema_owner",
          "objects created by the migrator belong to the schema owner role, not the login");
      });
    } finally { await migrator.end(); }
  } else {
    if (process.env.CI === "true") throw new Error("CI must run the reviewed runner plan and apply (O_NOFOLLOW unavailable)");
    results.push({ step: "5c/5d. runner plan + apply", ok: null, detail: "skipped: this OS lacks O_NOFOLLOW; runs in Linux CI" });
  }
  rmSync(source, { recursive: true, force: true });

  await step("6. audit sealing via the dedicated sealer; legacy sealing and tampering refused", async () => {
    const appUrl = roleUrl("payrollph_app", passwords.get("payrollph_app"));
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query(`INSERT INTO public.audit_events (organization_id, actor, action, resource, metadata)
        VALUES (NULL, 'rehearsal', 'Rehearsal event', 'cutover', '{}'::jsonb)`);
      await assert.rejects(() => app.query("SELECT public.seal_audit_events(10)"), "legacy sealing as the app login must fail");
      await assert.rejects(() => app.query("UPDATE public.audit_events SET actor='tamper'"));
    } finally { await app.end(); }
    await assert.rejects(() => q("TRUNCATE public.audit_events"), /cannot be truncated/);
    const { dispatchAuditSealing } = await import("../../src/lib/audit-sealer-connection.ts");
    const sealed = await dispatchAuditSealing(async () => { throw new Error("legacy path must not run"); }, (c) => new pg.Client(c), 50, {
      AUDIT_ROLE_ISOLATION_PROOF_ENABLED: "true", // critical flag auditRoleIsolationProof
      AUDIT_SEALER_DATABASE_URL: roleUrl("payrollph_sealer_login", passwords.get("payrollph_sealer_login")),
      DATABASE_URL: appUrl, NODE_ENV: "development",
    });
    assert.equal(sealed, 1);
    const { rows: [row] } = await q("SELECT chain_seq IS NOT NULL AS sealed FROM public.audit_events WHERE action='Rehearsal event'");
    assert.equal(row.sealed, true);
    return { sealed };
  });

  console.log(JSON.stringify({ kind: "clean-baseline-cutover-rehearsal", database: "disposable localhost " + DB, throughPrefix, results,
    neonTouched: false, productionApproved: false }, null, 2));
} catch {
  console.log(JSON.stringify({ kind: "clean-baseline-cutover-rehearsal", failed: true, results }, null, 2));
  process.exitCode = 1;
} finally {
  await admin.end();
}

