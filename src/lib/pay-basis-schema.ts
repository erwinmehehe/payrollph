import { pool } from "@/db";
import type { PoolClient } from "pg";
import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { payBasisSchemaSpec, verifyRequestSchemaReadOnly } from "@/lib/request-schema-readonly";

let schemaReady = false;
let schemaInFlight: Promise<void> | null = null;
let readOnlyReady = false;
let readOnlyInFlight: Promise<void> | null = null;

export async function ensureEmployeePayProfileSchema() {
  // Even payroll workers must not issue schema DDL in an explicitly
  // reviewed read-only cutover mode. Do not cache legacy readiness here.
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (readOnlyReady) return;
    if (readOnlyInFlight) return readOnlyInFlight;
    readOnlyInFlight = (async () => {
      let client: PoolClient | null = null;
      let verified = false;
      try {
        client = await pool.connect();
        const connected = client;
        await verifyRequestSchemaReadOnly(
          (sql, args) => connected.query(sql, args),
          payBasisSchemaSpec,
        );
        verified = true;
        readOnlyReady = true;
      } finally {
        client?.release(!verified);
        readOnlyInFlight = null;
      }
    })();
    return readOnlyInFlight;
  }
  if (schemaReady) return;
  if (schemaInFlight) return schemaInFlight;

  schemaInFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_employee_pay_profile_schema_v1'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_pay_profiles (
          id serial PRIMARY KEY,
          employee_id integer NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          pay_basis varchar(16) NOT NULL,
          rate_amount numeric(12,2) NOT NULL,
          standard_work_days_per_month numeric(6,2) NOT NULL,
          standard_hours_per_day numeric(5,2) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS employee_pay_profiles_org_idx ON employee_pay_profiles(organization_id)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_pay_revisions (
          id serial PRIMARY KEY,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          effective_date date NOT NULL,
          previous_pay_basis varchar(16) NOT NULL,
          previous_rate_amount numeric(12,2) NOT NULL,
          previous_standard_work_days_per_month numeric(6,2) NOT NULL,
          previous_standard_hours_per_day numeric(5,2) NOT NULL,
          new_pay_basis varchar(16) NOT NULL,
          new_rate_amount numeric(12,2) NOT NULL,
          new_standard_work_days_per_month numeric(6,2) NOT NULL,
          new_standard_hours_per_day numeric(5,2) NOT NULL,
          reason varchar(240) NOT NULL DEFAULT 'Pay change',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS employee_pay_revisions_org_employee_idx ON employee_pay_revisions(organization_id, employee_id)");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_revisions_employee_effective_idx ON employee_pay_revisions(employee_id, effective_date)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_pay_retro_adjustments (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          revision_id integer NOT NULL REFERENCES employee_pay_revisions(id) ON DELETE CASCADE,
          source_payroll_run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
          source_period_label varchar(80) NOT NULL,
          amount numeric(12,2) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          settled_payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          settled_at timestamptz
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS employee_pay_retro_org_employee_idx ON employee_pay_retro_adjustments(organization_id, employee_id)");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_retro_revision_run_idx ON employee_pay_retro_adjustments(revision_id, source_payroll_run_id)");
      await client.query("COMMIT");
      schemaReady = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      schemaInFlight = null;
    }
  })();

  return schemaInFlight;
}

/**
 * Existing Linaw employees were historically defined by a monthly basic rate.
 * Backfill those records as explicit monthly profiles without changing their
 * stored monthly amount. Newly-created employees write a profile directly.
 */
export async function ensureEmployeePayProfiles(organizationId: number) {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  await ensureEmployeePayProfileSchema();
  if (mode === "read-only") {
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
      // Missing profiles require a separately approved DBA data backfill.
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
      return;
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
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO employee_pay_profiles (
        employee_id,
        organization_id,
        pay_basis,
        rate_amount,
        standard_work_days_per_month,
        standard_hours_per_day
      )
      SELECT
        e.id,
        e.organization_id,
        'monthly',
        e.basic_rate,
        22,
        8
      FROM employees e
      WHERE e.organization_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM employee_pay_profiles p WHERE p.employee_id = e.id
        )
      ON CONFLICT (employee_id) DO NOTHING`,
      [organizationId],
    );
  } finally {
    client.release();
  }
}
