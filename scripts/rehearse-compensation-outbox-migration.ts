import type { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db";
import {
  inspectCompensationOutboxSchema,
  validateCompensationOutboxSchema,
} from "../src/lib/compensation-release-schema";

/**
 * DDL transaction rehearsal is CI ONLY, against a disposable local Postgres.
 * Creates and rolls back a throwaway schema; no committed application tables,
 * payroll data, bank records, or release approvals are modified.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  let safeLocal = false;
  try {
    const target = new URL(url ?? "");
    safeLocal = ["127.0.0.1", "localhost"].includes(target.hostname)
      && target.port === "5432"
      && target.pathname === "/app_db";
  } catch { /* missing or invalid URL */ }

  if (process.env.CI !== "true"
    || process.env.COMPENSATION_MIGRATION_REHEARSAL_MODE !== "isolated-ci-only"
    || !safeLocal) {
    console.error("Refusing compensation migration rehearsal outside the isolated CI PostgreSQL service.");
    process.exitCode = 2;
    await pool.end();
    return;
  }

  const schema = `comp_outbox_qa_${randomBytes(7).toString("hex")}`;
  let client: PoolClient | undefined;
  let compatible = false;
  let issues: string[] = [];
  try {
    const ddl = await readFile("drizzle/0100_compensation_automation_intents.sql", "utf8");
    if (!ddl.includes('CREATE TABLE IF NOT EXISTS "compensation_automation_intents"')) {
      throw new Error("Approved migration source does not define the intended table.");
    }
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(ddl);
    const first = validateCompensationOutboxSchema(
      await inspectCompensationOutboxSchema(client, schema),
    );
    // The script uses IF NOT EXISTS. Re-apply to verify the migration does not
    // fail on a populated schema, but NEVER treat this as drift verification.
    await client.query(ddl);
    const second = validateCompensationOutboxSchema(
      await inspectCompensationOutboxSchema(client, schema),
    );
    issues = [...first.issues, ...second.issues];
    compatible = first.schemaCompatible && second.schemaCompatible;
    await client.query("ROLLBACK");
    const residue = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1) AS exists",
      [schema],
    );
    if (residue.rows[0]?.exists) {
      compatible = false;
      issues.push("rehearsal_schema_not_rolled_back");
    }
  } catch {
    compatible = false;
    issues.push("rehearsal_failed");
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* lost database connection */ }
    }
  } finally {
    client?.release();
    await pool.end();
  }

  console.log(JSON.stringify({
    kind: "compensation-outbox-isolated-migration-rehearsal",
    migration: "drizzle/0100_compensation_automation_intents.sql",
    compatible,
    issues,
    changesCommitted: false,
    readOnlyProductionAccess: true,
    independentPayrollAcceptance: false,
  }, null, 2));
  process.exitCode = compatible ? 0 : 1;
}

void main();
