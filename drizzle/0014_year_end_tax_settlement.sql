ALTER TABLE "year_end_adjustments"
  ADD COLUMN IF NOT EXISTS "applied_payroll_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "year_end_adjustments_applied_run_idx"
  ON "year_end_adjustments" ("applied_payroll_run_id");

