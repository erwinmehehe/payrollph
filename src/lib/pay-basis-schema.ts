import { pool } from "@/db";

let schemaReady = false;
let historySchemaReady = false;
let schemaInFlight: Promise<void> | null = null;
let historySchemaInFlight: Promise<void> | null = null;

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


export async function ensureEmployeePayHistorySchema() {
  if (historySchemaReady) return;
  if (historySchemaInFlight) return historySchemaInFlight;

  historySchemaInFlight = (async () => {
    await ensureEmployeePayProfileSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_employee_pay_history_schema_v1'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_pay_rate_changes (
          id serial PRIMARY KEY,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          effective_from date NOT NULL,
          pay_basis varchar(16) NOT NULL,
          rate_amount numeric(12,2) NOT NULL,
          standard_work_days_per_month numeric(6,2) NOT NULL,
          standard_hours_per_day numeric(5,2) NOT NULL,
          reason varchar(200),
          created_by varchar(120),
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_rate_changes_employee_effective_unique
        ON employee_pay_rate_changes(employee_id, effective_from)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_pay_rate_changes_org_idx
        ON employee_pay_rate_changes(organization_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_pay_adjustments (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          rate_change_id integer REFERENCES employee_pay_rate_changes(id) ON DELETE CASCADE,
          adjustment_type varchar(32) NOT NULL DEFAULT 'retro_basic',
          amount numeric(12,2) NOT NULL,
          service_year integer NOT NULL,
          service_from date NOT NULL,
          service_through date NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          payroll_run_id integer,
          notes text,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          paid_at timestamptz
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_adjustments_rate_year_unique
        ON employee_pay_adjustments(rate_change_id, service_year)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_pay_adjustments_org_status_idx
        ON employee_pay_adjustments(organization_id, status)
      `);
      await client.query("ALTER TABLE historical_payroll_entries ADD COLUMN IF NOT EXISTS basic_salary_earned numeric(14,2)");
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS unpaid_salary numeric(12,2) NOT NULL DEFAULT 0");
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS basic_salary_earned_ytd numeric(14,2) NOT NULL DEFAULT 0");
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS thirteenth_month_previously_paid numeric(12,2) NOT NULL DEFAULT 0");
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_pay_due_date date");
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_pay_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb");
      await client.query("COMMIT");
      historySchemaReady = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      historySchemaInFlight = null;
    }
  })();

  return historySchemaInFlight;
}

export async function ensureEmployeePayHistory(organizationId: number) {
  await ensureEmployeePayProfiles(organizationId);
  await ensureEmployeePayHistorySchema();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO employee_pay_rate_changes (
        employee_id,
        organization_id,
        effective_from,
        pay_basis,
        rate_amount,
        standard_work_days_per_month,
        standard_hours_per_day,
        reason,
        created_by
      )
      SELECT
        e.id,
        e.organization_id,
        e.start_date,
        p.pay_basis,
        p.rate_amount,
        p.standard_work_days_per_month,
        p.standard_hours_per_day,
        'Opening pay profile migrated from existing employee record',
        'System'
      FROM employees e
      INNER JOIN employee_pay_profiles p ON p.employee_id = e.id
      WHERE e.organization_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM employee_pay_rate_changes h WHERE h.employee_id = e.id
        )
      ON CONFLICT (employee_id, effective_from) DO NOTHING`,
      [organizationId],
    );
  } finally {
    client.release();
  }
}
