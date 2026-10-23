/**
 * Test fixtures only. Payroll no longer invents pay profiles at request time,
 * and the app writes one whenever it creates an employee. Fixtures that insert
 * employees directly must do the same: this gives each employee of the run's
 * employer that has no profile the monthly profile the retired request-time
 * backfill used (basic rate, 22 days, 8 hours). Idempotent.
 */
export async function seedMonthlyPayProfilesForRun(payrollRunId: number) {
  // Imported lazily so database-gated tests that skip never require DATABASE_URL.
  const { pool } = await import("../../src/db");
  const result = await pool.query(
    `INSERT INTO employee_pay_profiles (
       employee_id, organization_id, pay_basis, rate_amount,
       standard_work_days_per_month, standard_hours_per_day
     )
     SELECT e.id, e.organization_id, 'monthly', e.basic_rate, 22, 8
     FROM employees e
     JOIN payroll_runs r ON r.organization_id = e.organization_id
     WHERE r.id = $1
       AND NOT EXISTS (SELECT 1 FROM employee_pay_profiles p WHERE p.employee_id = e.id)
     ON CONFLICT (employee_id) DO NOTHING`,
    [payrollRunId],
  );
  return result.rowCount ?? 0;
}
