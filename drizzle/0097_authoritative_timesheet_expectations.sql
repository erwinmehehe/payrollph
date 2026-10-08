-- Authoritative "timesheet expected but never submitted" source records.
-- Existing payroll runs are intentionally not backfilled because historical employee
-- cohort membership cannot be reconstructed safely after org/employee state changes.
CREATE TABLE IF NOT EXISTS "workforce_timesheet_expectations" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE SET NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "expected_by" date NOT NULL,
  "enforcement_mode" varchar(16) NOT NULL DEFAULT 'advisory',
  "status" varchar(24) NOT NULL DEFAULT 'expected',
  "version" integer NOT NULL DEFAULT 1,
  "latest_timesheet_id" integer REFERENCES "workforce_timesheets"("id") ON DELETE SET NULL,
  "latest_timesheet_version" integer,
  "first_submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workforce_timesheet_expectation_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "workforce_timesheet_expectation_mode_check" CHECK ("enforcement_mode" IN ('advisory','block')),
  CONSTRAINT "workforce_timesheet_expectation_status_check" CHECK ("status" IN ('expected','submitted','approved','cancelled')),
  CONSTRAINT "workforce_timesheet_expectation_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_timesheet_expectation_run_employee_unique"
  ON "workforce_timesheet_expectations" ("payroll_run_id","employee_id");
CREATE INDEX IF NOT EXISTS "workforce_timesheet_expectation_due_idx"
  ON "workforce_timesheet_expectations" ("organization_id","status","expected_by");
CREATE INDEX IF NOT EXISTS "workforce_timesheet_expectation_employee_period_idx"
  ON "workforce_timesheet_expectations" ("organization_id","employee_id","period_start","period_end");

DO $case_types$
BEGIN
  IF to_regclass('automation_operational_cases') IS NOT NULL THEN
    ALTER TABLE automation_operational_cases
      DROP CONSTRAINT IF EXISTS automation_operations_case_type_check;
    ALTER TABLE automation_operational_cases
      ADD CONSTRAINT automation_operations_case_type_check
      CHECK (case_type IN (
        'coverage_recovery',
        'timesheet_escalation',
        'missing_timesheet_escalation',
        'attendance_resolution',
        'payroll_readiness',
        'statutory_followup',
        'execution_dead_letter'
      ));
  END IF;
END
$case_types$;
