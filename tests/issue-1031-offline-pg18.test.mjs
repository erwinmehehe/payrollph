/**
 * This opt-in contract only runs against the exact CI-owned disposable PG18
 * fixture. No Neon, production URLs, customer rows or migration replay.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { parseOfflineExport } from "../scripts/lib/issue-1031-offline-parity.mjs";

const DISPOSABLE_URL = "postgresql://fixture:fixture@127.0.0.1:5432/issue1031_offline_fixture";
const providedUrl = process.env.ISSUE1031_DISPOSABLE_PG_URL;

test("V2 SQL runs on a disposable PG18 and exports structural index metadata", {
  skip: !providedUrl && "Only the explicit disposable PG18 fixture job may connect",
}, async () => {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(providedUrl, DISPOSABLE_URL, "refuse any other database identity");
  assert.equal(process.env.DATABASE_URL ?? "", "", "do not accept application DB credentials");
  assert.equal(process.env.PRODUCTION_DATABASE_URL ?? "", "", "no production credentials");
  const { buildIssue1031OfflineExportSql } = await import("../scripts/issue-1031-offline-export-sql.ts");
  const client = new Client({connectionString: DISPOSABLE_URL, connectionTimeoutMillis: 5000});
  await client.connect();
  try {
    const version = await client.query("SELECT current_setting('server_version_num')::int AS version");
    assert.ok(version.rows[0].version >= 180000 && version.rows[0].version < 190000);
    await client.query(`
      CREATE TABLE public.fictional_payroll_index_proof (
        id integer NOT NULL, amount numeric(14,2) NOT NULL, note text
      );
      CREATE UNIQUE INDEX fictional_payroll_desc_include_idx
        ON public.fictional_payroll_index_proof USING btree (amount DESC NULLS FIRST)
        INCLUDE (note) NULLS NOT DISTINCT WITH (fillfactor=70);
    `);
    const sql = buildIssue1031OfflineExportSql("disposable-pg18");
    assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
    const replies = await client.query(sql);
    const results = Array.isArray(replies) ? replies : [replies];
    const payload = results.find(result => result.rows?.[0]?.jsonb_build_object)
      ?.rows[0].jsonb_build_object;
    assert.ok(payload, "owner-run SQL must return exactly one exported JSON payload");
    const exportData = parseOfflineExport(payload, "disposable-pg18");
    const index = exportData.catalogRows.find(row =>
      row.kind === "index" && row.object_name === "fictional_payroll_desc_include_idx");
    assert.ok(index, "disposable index must be in the export");
    assert.deepEqual(index.details.key_desc, [true]);
    assert.deepEqual(index.details.key_nulls_first, [true]);
    assert.deepEqual(index.details.include, ["note"]);
    assert.deepEqual(index.details.options, ["fillfactor=70"]);
    assert.equal(index.details.nulls_not_distinct, true);
    assert.equal(index.details.tablespace, null);
    assert.equal(exportData.historicalReceipts.length, 0);
    assert.equal(exportData.appliedMigrations.length, 0);
  } finally {
    await client.end();
  }
});
