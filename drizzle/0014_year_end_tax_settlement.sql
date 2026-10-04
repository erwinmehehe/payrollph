ALTER TABLE year_end_adjustments
  ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'computed',
  ADD COLUMN IF NOT EXISTS payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by varchar(120),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS year_end_adjustments_run_status_idx
  ON year_end_adjustments (payroll_run_id, status);

CREATE INDEX IF NOT EXISTS year_end_adjustments_org_year_status_idx
  ON year_end_adjustments (organization_id, tax_year, status);
