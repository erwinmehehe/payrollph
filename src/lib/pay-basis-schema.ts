import { pool } from "@/db";
import type { PoolClient } from "pg";
import { cachedRequestSchemaVerifier, payBasisSchemaSpec } from "@/lib/request-schema-readonly";

/**
 * Payroll and workers never issue schema DDL. The pay-profile tables come only
 * from reviewed numbered migrations; this checks the catalog and fails closed.
 */
export const ensureEmployeePayProfileSchema = cachedRequestSchemaVerifier(pool, payBasisSchemaSpec);

/**
 * Every employee must already have an explicit pay profile. New employees
 * write one directly; a missing profile is never silently invented from the
 * legacy monthly basic rate at request time. It needs a reviewed data backfill.
 */
export async function ensureEmployeePayProfiles(organizationId: number) {
  await ensureEmployeePayProfileSchema();
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("READONLY_PAY_PROFILE_INVALID_TENANT");
  }
  let client: PoolClient | null = null;
  let transactionOpen = false;
  let rolledBack = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    transactionOpen = true;
    // Tenant-scoped existence check, not a silent write or conversion.
    const result = await client.query<{ missing: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM employees e
        LEFT JOIN employee_pay_profiles p
          ON p.employee_id = e.id AND p.organization_id = e.organization_id
        WHERE e.organization_id = $1 AND p.id IS NULL
      ) AS missing`,
      [organizationId],
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    rolledBack = true;
    if (result.rows.length !== 1 || result.rows[0].missing !== false) {
      throw new Error("READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL");
    }
  } finally {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    // A failed connection/ROLLBACK must not return an open transaction
    // to the pool, even if the original query failed first.
    client?.release(!rolledBack);
  }
}
