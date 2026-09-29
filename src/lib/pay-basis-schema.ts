import { pool } from "@/db";

let schemaReady = false;
let schemaInFlight: Promise<void> | null = null;

export async function ensureEmployeePayProfileSchema() {
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
  await ensureEmployeePayProfileSchema();
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
