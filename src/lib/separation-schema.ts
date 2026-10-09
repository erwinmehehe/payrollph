import { pool } from "@/db";

let separationSchemaPromise: Promise<void> | null = null;

export function ensureSeparationSchema() {
  separationSchemaPromise ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS thirteenth_entitlement numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS thirteenth_paid_ytd numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS basic_salary_earned_ytd numeric(14,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS historical_basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS unpaid_basic_salary numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS separation_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS retirement_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS other_benefits numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_statutory_deductions numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS gross_final_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_pay_due_date date');
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS computation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb");
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS approved_at timestamptz');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS released_at timestamptz');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS release_reference varchar(160)');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS prepared_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS released_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      separationSchemaPromise = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return separationSchemaPromise;
}
