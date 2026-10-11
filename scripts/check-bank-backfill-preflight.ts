import "dotenv/config";
import { Client } from "pg";
import { bankBackfillColumns, bankBackfillSchemaGaps, type BankColumn } from "../src/lib/bank-backfill-preflight";

/** Catalog-only, explicit-target preflight. No DDL, DML, bank values or credentials printed. */
async function main() {
  const url = process.env.DATABASE_URL;
  const expectedDb = process.env.EXPECTED_PRODUCTION_DATABASE_NAME;
  const mode = process.env.BANK_BACKFILL_ROLE;
  if (!url || !expectedDb || !["audit", "apply"].includes(mode ?? "")) {
    throw new Error("Bank preflight requires a selected database, expected name and audit/apply mode.");
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  let connected = false;
  let inTransaction = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    const identity = await client.query<{
      matches: boolean; readOnly: boolean; elevated: boolean; writePrivilege: boolean;
    }>(`
      SELECT
        current_database() = $1::text AS matches,
        current_setting('transaction_read_only') = 'on' AS "readOnly",
        (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
           FROM pg_catalog.pg_roles WHERE rolname = current_user) AS elevated,
        pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
          OR pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
              AND pg_catalog.has_table_privilege(current_user, c.oid,
                'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          ) AS "writePrivilege"
    `, [expectedDb]);
    const status = identity.rows[0];
    if (!status?.matches || !status.readOnly || (mode === "audit" && (status.elevated || status.writePrivilege))) {
      throw new Error("Incorrect target database or insufficient read-only audit-role isolation.");
    }
    const catalog = await client.query<BankColumn>(`
      SELECT c.relname || '.' || a.attname AS name,
             t.typname AS "typeName",
             CASE WHEN t.typname = 'varchar' AND a.atttypmod >= 0
                  THEN a.atttypmod - 4 ELSE NULL END AS "maxLength"
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND (c.relname || '.' || a.attname) = ANY($1::text[])
    `, [[...bankBackfillColumns]]);
    const gaps = bankBackfillSchemaGaps(catalog.rows);
    await client.query("ROLLBACK");
    inTransaction = false;
    if (gaps.length) throw new Error("Bank backfill schema is incompatible: " + gaps.join(", "));
    console.log("Bank backfill schema matches four expected stores; the named DB was confirmed.");
    console.log("Structure-only verification. Bank row encryption, migration receipts and host identity remain separate gates.");
  } finally {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* already disconnected */ }
    }
    if (connected) {
      try { await client.end(); } catch { /* already disconnected */ }
    }
  }
}

void main().catch(() => {
  // Do not include PostgreSQL error messages: they may contain connection details.
  console.error("Bank schema preflight did not pass. No database changes were performed.");
  process.exitCode = 1;
});
