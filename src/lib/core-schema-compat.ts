import type { PoolClient } from "pg";
import { coreSchemaCompatibilityMode, verifyCoreSchemaReadOnly } from "@/lib/core-schema-readonly";
import { pool } from "@/db";
import { bankEncryptionConfigured } from "@/lib/bank-account-crypto";

let coreSchemaReadOnlyReady = false;
let coreSchemaReadOnlyInFlight: Promise<void> | null = null;

export async function bankDataEncryptionReady() {
  if (!bankEncryptionConfigured()) return false;
  await ensureCoreCompatibilitySchema();
  const result = await pool.query<{ remaining: number }>(`
    SELECT (
      (SELECT COUNT(*) FROM employees
       WHERE bank_account IS NOT NULL
         AND bank_account <> ''
         AND bank_account NOT LIKE 'enc:v1:%')
      +
      (SELECT COUNT(*) FROM payroll_entries
       WHERE trace #>> '{payment,bankAccount}' IS NOT NULL
         AND trace #>> '{payment,bankAccount}' <> ''
         AND trace #>> '{payment,bankAccount}' NOT LIKE 'enc:v1:%')
    )::int AS remaining
  `);
  return Number(result.rows[0]?.remaining ?? 0) === 0;
}

/**
 * Request paths never create, modify or backfill database objects. All release
 * modes verify the reviewed schema through a read-only catalog transaction and
 * fail closed if it is incomplete. The registered rollout flag still governs
 * mode validation; a legacy setting never enables DDL here.
 * This is structural evidence, not proof of migration history or permissions.
 */
export async function ensureCoreCompatibilitySchema() {
  // Validate even after a successful cached check, so flag-on rejects legacy.
  coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (coreSchemaReadOnlyReady) return;
  if (coreSchemaReadOnlyInFlight) return coreSchemaReadOnlyInFlight;

  coreSchemaReadOnlyInFlight = (async () => {
    let client: PoolClient | null = null;
    let verifiedAndRolledBack = false;
    try {
      client = await pool.connect();
      const connected = client;
      await verifyCoreSchemaReadOnly((sql, parameters) => connected.query(sql, parameters));
      verifiedAndRolledBack = true;
      coreSchemaReadOnlyReady = true;
    } finally {
      // Never reuse a client if catalog inspection or its rollback failed.
      client?.release(!verifiedAndRolledBack);
      coreSchemaReadOnlyInFlight = null;
    }
  })();

  return coreSchemaReadOnlyInFlight;
}
