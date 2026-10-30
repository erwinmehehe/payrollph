#!/usr/bin/env node
/**
 * READ-ONLY source presence PLUS type/constraint/index parity on disposable PG18.
 * Run after guarded first Drizzle push and source baseline supplement.
 * Does not certify historical/applied migrations, production receipts or schema,
 * or an actual Neon instance. Never reads business rows or Neon credentials.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assertSourceBaselineParity,
  assertSourceBaselineConstraintParity,
} from "../lib/source-baseline-parity.mjs";
import { assertDisposablePG18Environment } from "./fresh-pg18-development-schema.mjs";

const URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

/** Catalog metadata only. Do not interpolate source identifiers into SQL.
 * pg_indexes includes PK/UNIQUE backing indexes; those are compared through
 * their named constraints, not double-counted as user-declared Drizzle indexes.
 * Include raw information_schema fields and pg_indexes.indexdef as evidence,
 * while comparing lossless PostgreSQL type/index/constraint attributes.
 */
export async function readSourceBaselineCatalog(client) {
  const columns = await client.query(String.raw`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.column_default, c.identity_generation,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
           (c.is_nullable = 'YES') AS nullable,
           c.column_default AS "default",
           CASE c.identity_generation
             WHEN 'ALWAYS' THEN 'always'
             WHEN 'BY DEFAULT' THEN 'byDefault'
             ELSE NULL
           END AS identity
      FROM information_schema.columns AS c
      JOIN pg_catalog.pg_namespace AS n
        ON n.nspname = c.table_schema
      JOIN pg_catalog.pg_class AS t
        ON t.relnamespace = n.oid AND t.relname = c.table_name
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = t.oid AND a.attname = c.column_name
       AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.table_schema = 'public' AND t.relkind IN ('r', 'p')
     ORDER BY c.table_name, c.ordinal_position
  `);

  // information_schema.table_constraints identifies the visible constraints;
  // pg_constraint provides exact owning relation, key ordinals and expressions.
  // Cast pg_catalog.name[] keys to text[] so node-postgres decodes JS arrays.
  const constraints = await client.query(String.raw`
    SELECT tc.table_name, tc.constraint_name AS object_name,
           CASE con.contype
             WHEN 'p' THEN 'primary_key'
             WHEN 'f' THEN 'foreign_key'
             WHEN 'u' THEN 'unique_constraint'
             WHEN 'c' THEN 'check'
           END AS kind,
           ARRAY(
             SELECT att.attname::text
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute AS att
                 ON att.attrelid = con.conrelid AND att.attnum = k.attnum
              ORDER BY k.ord
           ) AS columns,
           ref.relname AS ref_table,
           ARRAY(
             SELECT att.attname::text
               FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute AS att
                 ON att.attrelid = con.confrelid AND att.attnum = k.attnum
              ORDER BY k.ord
           ) AS ref_columns,
           CASE con.confdeltype
             WHEN 'a' THEN 'no action'
             WHEN 'r' THEN 'restrict'
             WHEN 'c' THEN 'cascade'
             WHEN 'n' THEN 'set null'
             WHEN 'd' THEN 'set default'
           END AS on_delete,
           CASE con.confupdtype
             WHEN 'a' THEN 'no action'
             WHEN 'r' THEN 'restrict'
             WHEN 'c' THEN 'cascade'
             WHEN 'n' THEN 'set null'
             WHEN 'd' THEN 'set default'
           END AS on_update,
           pg_catalog.pg_get_expr(con.conbin, con.conrelid) AS expression,
           COALESCE(ix.indnullsnotdistinct, false) AS nulls_not_distinct,
           con.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
      FROM information_schema.table_constraints AS tc
      JOIN pg_catalog.pg_namespace AS n ON n.nspname = tc.table_schema
      JOIN pg_catalog.pg_class AS t
        ON t.relnamespace = n.oid AND t.relname = tc.table_name
      JOIN pg_catalog.pg_constraint AS con
        ON con.conrelid = t.oid AND con.conname = tc.constraint_name
      LEFT JOIN pg_catalog.pg_class AS ref ON ref.oid = con.confrelid
      LEFT JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = con.conindid
     WHERE tc.table_schema = 'public'
       AND con.contype IN ('p', 'f', 'u', 'c')
     ORDER BY tc.table_name, tc.constraint_name
  `);

  const indexes = await client.query(String.raw`
    SELECT pi.tablename AS table_name, pi.indexname AS object_name,
           pi.indexdef AS definition, idx.indisunique AS "unique",
           am.amname AS method,
           ARRAY(
             SELECT pg_catalog.pg_get_indexdef(idx.indexrelid, k, true)
               FROM generate_series(1, idx.indnkeyatts) AS k
              ORDER BY k
           ) AS keys,
           -- pg_get_indexdef(indexrelid, key-number) omits B-tree DESC /
           -- NULLS FIRST flags. pg_index.indoption has their actual values.
           ARRAY(
             SELECT COALESCE((idx.indoption[k - 1] & 1) <> 0, false)
               FROM generate_series(1, idx.indnkeyatts) AS k ORDER BY k
           ) AS key_desc,
           ARRAY(
             SELECT COALESCE((idx.indoption[k - 1] & 2) <> 0, false)
               FROM generate_series(1, idx.indnkeyatts) AS k ORDER BY k
           ) AS key_nulls_first,
           ARRAY(
             SELECT pg_catalog.pg_get_indexdef(idx.indexrelid, k, true)
               FROM generate_series(idx.indnkeyatts + 1, idx.indnatts) AS k
              ORDER BY k
           ) AS included_columns,
           COALESCE(ix.reloptions, ARRAY[]::text[]) AS storage_options,
           idx.indnullsnotdistinct AS nulls_not_distinct,
           CASE WHEN ix.reltablespace = 0 THEN NULL ELSE ts.spcname END AS tablespace,
           pg_catalog.pg_get_expr(idx.indpred, idx.indrelid) AS predicate,
           idx.indisvalid AS valid, idx.indisready AS ready
      FROM pg_catalog.pg_indexes AS pi
      JOIN pg_catalog.pg_namespace AS n ON n.nspname = pi.schemaname
      JOIN pg_catalog.pg_class AS t
        ON t.relnamespace = n.oid AND t.relname = pi.tablename
      JOIN pg_catalog.pg_class AS ix
        ON ix.relnamespace = n.oid AND ix.relname = pi.indexname
      JOIN pg_catalog.pg_index AS idx
        ON idx.indrelid = t.oid AND idx.indexrelid = ix.oid
      JOIN pg_catalog.pg_am AS am ON am.oid = ix.relam
      LEFT JOIN pg_catalog.pg_tablespace AS ts ON ts.oid = ix.reltablespace
     WHERE pi.schemaname = 'public' AND t.relkind IN ('r', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint AS con
          WHERE con.conindid = idx.indexrelid AND con.contype IN ('p','u','x')
       )
     ORDER BY pi.tablename, pi.indexname
  `);

  return {
    columns: columns.rows,
    objects: [
      ...columns.rows.map((row) => ({
        ...row, kind: "column", object_name: row.column_name,
      })),
      ...constraints.rows,
      ...indexes.rows.map((row) => ({ ...row, kind: "index" })),
    ],
  };
}

async function main() {
  assertDisposablePG18Environment(process.env);
  assert.equal(process.env.DATABASE_URL, URL, "DISPOSABLE_LOOPBACK_ONLY");
  assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined, "NO_PRODUCTION_CREDENTIALS");
  const client = new pg.Client({
    connectionString: URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 15000,
  });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const result = await client.query(
        "SELECT current_database() AS database, current_user AS login, " +
        "current_setting('server_version_num')::integer AS server"
      );
      const identity = result.rows[0];
      assert.equal(identity.database, "app_db");
      assert.equal(identity.login, "postgres");
      assert.ok(identity.server >= 180000 && identity.server < 190000, "PG18_REQUIRED");
      const catalog = await readSourceBaselineCatalog(client);
      const { generateSchemaManifest } = await import("../lib/issue-1031-schema-manifest.ts");
      const manifest = generateSchemaManifest();

      // The original presence ratchet runs first, unchanged and independently.
      const presence = assertSourceBaselineParity(manifest.tables, catalog.columns);
      const structure = assertSourceBaselineConstraintParity(manifest.tables, catalog.objects);
      assert.ok(presence.sourceTables >= 270, "SOURCE_MANIFEST_INCOMPLETE");
      assert.equal(presence.sourceColumns, structure.sourceColumns);
      await client.query("ROLLBACK");
      process.stdout.write("SOURCE_BASELINE_PARITY_PASS " + JSON.stringify({
        sourceTables: presence.sourceTables,
        sourceColumns: presence.sourceColumns,
        sourceConstraints: structure.sourceConstraints,
        sourceIndexes: structure.sourceIndexes,
        baselineOnlyTables: presence.migrationOrBaselineOnlyTables.length,
        additionalMigrationColumns: presence.unmodeledColumns.length,
        unmodeledConstraints: structure.unmodeledPrimaryKeys.length
          + structure.unmodeledForeignKeys.length
          + structure.unmodeledUniqueConstraints.length
          + structure.unmodeledChecks.length,
        unmodeledIndexes: structure.unmodeledIndexes.length,
        scope: "disposable PG18 source table/column presence plus type, nullability, default, identity, named PK/FK/unique/check and declared-index parity; no applied production migration, production receipt parity or real Neon validation",
        productionCertified: false,
        productionMigrationCertified: false,
        productionReceiptParityCertified: false,
        realNeonValidated: false,
      }) + "\n");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Only static schema/catalog identifier metadata, never application rows.
    process.stderr.write("SOURCE_BASELINE_PARITY_FAILED " +
      (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
  });
}
