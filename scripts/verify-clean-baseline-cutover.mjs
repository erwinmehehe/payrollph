#!/usr/bin/env node
/**
 * Read-only verification after the clean-baseline cutover, as the least-privilege
 * migration PLANNER: schema lineage, every historical migration's implied catalog,
 * the migration-control ledger privilege boundary, and that the cutover row
 * matches this commit's source manifest. Uses a READ ONLY transaction; writes nothing.
 *
 *   PLANNER_DATABASE_URL=... node scripts/verify-clean-baseline-cutover.mjs
 */
import pg from "pg";
import { assertModernSchemaLineage } from "./lib/schema-lineage-preflight.mjs";
import { assertHistoricalCatalog } from "./lib/historical-catalog-gate.mjs";
import { assertMigrationControlLedgerCatalog } from "./lib/reviewed-migration-control-ledger.mjs";
import { cutoverManifest } from "./lib/clean-baseline-cutover.mjs";

const url = process.env.PLANNER_DATABASE_URL;
if (!url) { console.error("PLANNER_DATABASE_URL is required."); process.exit(2); }
const { throughPrefix, manifest } = cutoverManifest();
const client = new pg.Client({ connectionString: url, application_name: "payrollph-cutover-verify" });
await client.connect();
const checks = [];
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  const { rows: [who] } = await client.query(`SELECT current_user AS role,
    EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) AS elevated`);
  if (who.role !== "payrollph_migration_planner" || who.elevated) throw new Error("VERIFY_MUST_RUN_AS_UNPRIVILEGED_PLANNER");
  checks.push("planner role");
  await assertModernSchemaLineage(client); checks.push("schema lineage");
  await assertHistoricalCatalog(client, throughPrefix); checks.push(`historical catalog through ${throughPrefix}`);
  await assertMigrationControlLedgerCatalog(client); checks.push("ledger privilege boundary");
  const { rows } = await client.query(`SELECT historical_prefix, historical_manifest_sha256,
    (SELECT count(*)::int FROM public.payrollph_release_migration_receipts WHERE disposition = 'baseline-included') AS receipts,
    (SELECT count(*)::int FROM public.payrollph_schema_migrations) AS forward
    FROM public.payrollph_migration_cutover`);
  if (rows.length !== 1 || rows[0].historical_prefix !== throughPrefix || rows[0].historical_manifest_sha256.trim() !== manifest.digest ||
      rows[0].receipts !== manifest.files.length) throw new Error("VERIFY_CUTOVER_ROW_DOES_NOT_MATCH_SOURCE");
  checks.push(`cutover row matches source (${rows[0].receipts} receipts, ${rows[0].forward} forward migrations)`);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ kind: "clean-baseline-cutover-verify", ok: true, checks, writes: false }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  const message = /^(VERIFY_|REVIEWED_MIGRATION_|HISTORICAL_|SCHEMA_LINEAGE)/.test(String(error?.message)) ? String(error.message).slice(0, 300) : `database error ${error?.code ?? "unknown"}`;
  console.log(JSON.stringify({ kind: "clean-baseline-cutover-verify", ok: false, checks, failed: message }, null, 2));
  process.exitCode = 1;
} finally {
  await client.end();
}
