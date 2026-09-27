-- Payroll + managed-service launch hardening.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS payroll_service_mode varchar(32) NOT NULL DEFAULT 'self_service',
  ADD COLUMN IF NOT EXISTS payroll_annual_divisor numeric(6,2) NOT NULL DEFAULT 365.00,
  ADD COLUMN IF NOT EXISTS statutory_deduction_mode varchar(32) NOT NULL DEFAULT 'split_evenly';

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS scope_org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculation_mode varchar(32) NOT NULL DEFAULT 'fixed_salary',
  ADD COLUMN IF NOT EXISTS service_mode varchar(32) NOT NULL DEFAULT 'self_service',
  ADD COLUMN IF NOT EXISTS review_stage varchar(32) NOT NULL DEFAULT 'preparation',
  ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

-- Historical rows cannot have their true cutoff reconstructed automatically.
-- This conservative backfill keeps the migration deployable; verify old runs before relying on historical reports.
UPDATE payroll_runs
SET period_end = COALESCE(period_end, pay_date),
    period_start = COALESCE(period_start, pay_date)
WHERE period_start IS NULL OR period_end IS NULL;

ALTER TABLE payroll_runs
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;

CREATE INDEX IF NOT EXISTS payroll_runs_org_period_idx ON payroll_runs (organization_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS payroll_runs_org_scope_idx ON payroll_runs (organization_id, scope_org_unit_id);

ALTER TABLE payroll_runs ALTER COLUMN rule_version SET DEFAULT 'PH-2026.09';
ALTER TABLE payslips ALTER COLUMN rule_version SET DEFAULT 'PH-2026.09';
ALTER TABLE year_end_adjustments ALTER COLUMN rule_version SET DEFAULT 'PH-2026.09';
