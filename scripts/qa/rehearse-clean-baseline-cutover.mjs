#!/usr/bin/env node
// Rehearses the clean-baseline recovery cutover on a DISPOSABLE localhost
// PostgreSQL only. Never point this at Neon or any shared database.
//
// Precondition: database "neondb" on 127.0.0.1:5432 was just built as
//   drizzle push of schema.ts + drizzle/0109 + docs/sql/source-baseline-supplement.sql
// Steps:
//   1. role layout: schema owner, ledger owner, migrator, planner, app runtime,
//      audit sealing/maintenance groups and a dedicated sealer login
//   2. migration-control ledgers (receipts, cutover, forward journal) with a
//      'baseline-included' receipt for every numbered file through the cutover prefix
//   3. drizzle/0133-equivalent v2 audit guards (review-only companion, bound in memory)
//   4. every reviewed-runner gate as the planner; plan + apply of a probe
//      migration as the migrator (needs O_NOFOLLOW, i.e. Linux)
//   5. audit sealing through the dedicated sealer; legacy sealing must now fail
// Credentials are random per run, exist only in this process, and are never printed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { constants, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { inventoryMigrationSources } from "../lib/migration-receipt-audit.mjs";
import { cutoverSourceManifest, evaluateReviewedMigration, runReviewedMigrationOnClient } from "../lib/reviewed-migration-runner.mjs";
import { assertModernSchemaLineage } from "../lib/schema-lineage-preflight.mjs";
import { assertHistoricalCatalog } from "../lib/historical-catalog-gate.mjs";
import { assertMigrationControlLedgerCatalog } from "../lib/reviewed-migration-control-ledger.mjs";
import { missingMigrationObjects, objectKey } from "../lib/migration-only-objects.mjs";

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
    const { rows: [s] } = await q(`SELECT current_database() db, inet_server_addr()::text addr,
      (SELECT count(*)::int FROM organizations) orgs, (SELECT count(*)::int FROM audit_events) audits,
      (SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'payrollph\\_%') roles`);
    assert.equal(s.db, DB);
    assert.ok(s.addr === null || s.addr === "127.0.0.1/32" || s.addr === "127.0.0.1", "localhost only");
    assert.equal(s.orgs, 0); assert.equal(s.audits, 0);
    assert.equal(s.roles, 0, "rehearsal roles must not exist yet (fresh server or cleaned up)");
    const { missing } = await missingMigrationObjects(admin);
    const keys = missing.map(objectKey);
    assert.ok(keys.every((k) => k.includes("_v2")), "only the deferred 0133 v2 guards may be missing: " + keys.join(","));
    return { missingBeforeV2: keys.length };
  });

  await step("1. role layout", async () => {
    for (const name of ["payrollph_migrator", "payrollph_migration_planner", "payrollph_app", "payrollph_sealer_login"]) {
      passwords.set(name, randomBytes(24).toString("hex"));
    }
    await q(`CREATE ROLE payrollph_schema_owner NOLOGIN NOINHERIT;
      CREATE ROLE payrollph_ledger_owner NOLOGIN NOINHERIT;
      CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
    // The migrator runs reviewed DDL as the schema owner (inherited membership); it
    // must never own or belong to the ledger owner.
    await q(`CREATE ROLE payrollph_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get("payrollph_migrator")}'`);
    await q(`CREATE ROLE payrollph_migration_planner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get("payrollph_migration_planner")}'`);
    await q(`CREATE ROLE payrollph_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get("payrollph_app")}'`);
    await q(`CREATE ROLE payrollph_sealer_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get("payrollph_sealer_login")}'`);
    await q("GRANT payrollph_schema_owner TO payrollph_migrator");
    await q(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE, CREATE ON SCHEMA public TO payrollph_schema_owner;
      GRANT USAGE ON SCHEMA public TO payrollph_migration_planner, payrollph_app, payrollph_audit_sealing, payrollph_audit_maintenance;
      GRANT CONNECT ON DATABASE ${DB} TO payrollph_migrator, payrollph_migration_planner, payrollph_app, payrollph_sealer_login;`);
    // Hand every application object to the schema owner.
    const objects = (await q(`SELECT c.relkind, quote_ident(c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') AND pg_get_userbyid(c.relowner)='postgres'
      -- serial/identity sequences follow their table's owner
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i'))
      ORDER BY c.relkind DESC`)).rows;
    for (const o of objects) {
      const kind = o.relkind === "S" ? "SEQUENCE" : o.relkind === "v" ? "VIEW" : o.relkind === "m" ? "MATERIALIZED VIEW" : "TABLE";
      await q(`ALTER ${kind} public.${o.name} OWNER TO payrollph_schema_owner`);
    }
    const functions = (await q(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)='postgres' AND p.prokind='f'`)).rows;
    for (const f of functions) await q(`ALTER FUNCTION ${f.sig} OWNER TO payrollph_schema_owner`);
    // Runtime DML only; no DDL, no TRUNCATE, append-only audit trail.
    await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payrollph_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payrollph_app;
      REVOKE UPDATE, DELETE ON public.audit_events FROM payrollph_app;
      REVOKE INSERT, UPDATE, DELETE ON public.audit_chain_heads FROM payrollph_app;
      GRANT SELECT ON public.audit_events TO payrollph_audit_sealing, payrollph_audit_maintenance;
      GRANT UPDATE(chain_seq, prev_hash, row_hash) ON public.audit_events TO payrollph_audit_sealing;
      GRANT SELECT, INSERT, UPDATE ON public.audit_chain_heads TO payrollph_audit_sealing;
      GRANT UPDATE, DELETE ON public.audit_events TO payrollph_audit_maintenance;`);
    return { tablesAndSequencesReowned: objects.length, functionsReowned: functions.length };
  });

  await step("2. migration-control ledgers, receipts and cutover row", async () => {
    const template = readFileSync("docs/engineering/reviewed-migration-cutover-template.sql", "utf8");
    const receiptsTemplate = readFileSync("docs/engineering/production-migration-receipt-journal-template.sql", "utf8");
    await q(receiptsTemplate);
    await q(template.split("-- DBA inserts ONE")[0]);
    for (const t of ["payrollph_release_migration_receipts", "payrollph_migration_cutover", "payrollph_schema_migrations"]) {
      await q(`ALTER TABLE public.${t} OWNER TO payrollph_ledger_owner`);
      await q(`REVOKE ALL ON public.${t} FROM PUBLIC`);
      await q(`GRANT SELECT ON public.${t} TO payrollph_migration_planner, payrollph_migrator`);
    }
    await q("GRANT INSERT ON public.payrollph_schema_migrations TO payrollph_migrator");
    await q("REVOKE ALL ON public.payrollph_release_migration_receipts, public.payrollph_migration_cutover, public.payrollph_schema_migrations FROM payrollph_app");
    const manifest = cutoverSourceManifest(inventory, throughPrefix);
    for (const file of manifest.files) {
      await q(`INSERT INTO public.payrollph_release_migration_receipts (migration_path, source_sha256, disposition, evidence_ref, reviewed_by)
        VALUES ($1, $2, 'baseline-included', $3, $4)`, [file.path, file.sha256, evidence + " source-first baseline", "rehearsal operator (fictional)"]);
    }
    await q(`INSERT INTO public.payrollph_migration_cutover (id, historical_prefix, historical_manifest_sha256, evidence_ref, reviewed_by, reviewed_at)
      VALUES (1, $1, $2, $3, $4, now())`, [throughPrefix, manifest.digest, evidence + " cutover", "rehearsal operator (fictional)"]);
    return { throughPrefix, receipts: manifest.files.length, duplicatePrefixGroups: manifest.duplicatePrefixes.length, manifestSha256: manifest.digest };
  });

  await step("3. v2 audit guards (0133-equivalent companion, bound in memory)", async () => {
    const companion = readFileSync("docs/sql/issue908-audit-trigger-boundary-REVIEW_ONLY.sql", "utf8").replaceAll("__ISSUE908_ISOLATED_BRANCH__", FICTIONAL_BRANCH);
    await q("BEGIN");
    try {
      await q(`SELECT set_config('neon.project_id', $1, true), set_config('neon.branch_id', $2, true)`, [PROJECT, FICTIONAL_BRANCH]);
      await q(companion);
      await q("COMMIT");
    } catch (error) { await q("ROLLBACK"); throw error; }
    // Membership only after the companion verified the groups had no members.
    await q("GRANT payrollph_audit_sealing TO payrollph_sealer_login");
    const { missing } = await missingMigrationObjects(admin);
    assert.deepEqual(missing.map(objectKey), [], "every migration-created object is now present");
    return { migrationOnlyObjectsMissing: 0 };
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
    await step("4a. planner: lineage, historical catalog and ledger gates", async () => {
      await planner.query("BEGIN READ ONLY");
      try {
        await assertModernSchemaLineage(planner);
        await assertHistoricalCatalog(planner, throughPrefix);
        await assertMigrationControlLedgerCatalog(planner);
      } finally { await planner.query("ROLLBACK"); }
    });
    await step("4b. planner: decision for the probe migration", async () => {
      const cutover = (await planner.query(`SELECT historical_prefix AS "historicalPrefix", historical_manifest_sha256 AS "historicalManifestSha256",
        evidence_ref AS "evidenceRef", reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt" FROM public.payrollph_migration_cutover`)).rows[0];
      const receipts = (await planner.query(`SELECT migration_path AS "migrationPath", source_sha256 AS sha256, disposition,
        evidence_ref AS "evidenceRef", reviewed_by AS "reviewedBy", recorded_at AS "recordedAt" FROM public.payrollph_release_migration_receipts`)).rows;
      const decision = evaluateReviewedMigration({ inventory: probeInventory, cutover, receipts, applied: [], requestedPath: probe.path, expectedSha256: probe.sha256 });
      assert.equal(decision.status, "ready");
      return { status: decision.status, historicReceiptsVerified: decision.historicReceiptsVerified };
    });
    if (nofollow) {
      await step("4c. planner: full runner plan (read-only)", async () => {
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
      await step("4d. migrator: apply probe, then re-apply is a no-op", async () => {
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
    results.push({ step: "4c/4d. runner plan + apply", ok: null, detail: "skipped: this OS lacks O_NOFOLLOW; runs in Linux CI" });
  }
  rmSync(source, { recursive: true, force: true });

  await step("5. audit sealing via the dedicated sealer; legacy sealing and tampering refused", async () => {
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

