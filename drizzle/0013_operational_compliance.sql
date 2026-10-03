ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS payroll_calendar_mode varchar(24) NOT NULL DEFAULT 'flexible';

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_payroll_calendar_mode_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_payroll_calendar_mode_check
      CHECK (payroll_calendar_mode IN ('flexible', 'ph_semi_monthly'));
  END IF;
END
$compat$;

ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS org_unit_id integer REFERENCES org_units(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS holidays_org_unit_date_idx
  ON holidays(organization_id, org_unit_id, holiday_date);

CREATE TABLE IF NOT EXISTS supplementary_earnings (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  earning_type varchar(32) NOT NULL,
  label varchar(120) NOT NULL,
  amount numeric(12,2) NOT NULL,
  taxable boolean NOT NULL DEFAULT true,
  include_in_sss_base boolean NOT NULL DEFAULT true,
  include_in_pagibig_base boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'approved',
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  created_by varchar(120) NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS supplementary_earnings_org_employee_idx
  ON supplementary_earnings(organization_id, employee_id);

CREATE INDEX IF NOT EXISTS supplementary_earnings_status_effective_idx
  ON supplementary_earnings(status, effective_date);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplementary_earnings_status_check'
  ) THEN
    ALTER TABLE supplementary_earnings
      ADD CONSTRAINT supplementary_earnings_status_check
      CHECK (status IN ('pending', 'approved', 'settled', 'void'));
  END IF;
END
$compat$;


CREATE TABLE IF NOT EXISTS bank_file_validations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  template_name varchar(100) NOT NULL,
  template_version varchar(32) NOT NULL,
  file_name varchar(180) NOT NULL,
  file_sha256 varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'generated',
  portal_reference varchar(120),
  submitted_at timestamptz,
  outcome_note text,
  generated_by varchar(120) NOT NULL,
  recorded_by varchar(120),
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_file_validation_unique
  ON bank_file_validations(organization_id, template_name, template_version, file_sha256);

CREATE INDEX IF NOT EXISTS bank_file_validation_status_idx
  ON bank_file_validations(status, template_name);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_file_validations_status_check'
  ) THEN
    ALTER TABLE bank_file_validations
      ADD CONSTRAINT bank_file_validations_status_check
      CHECK (status IN ('generated', 'accepted', 'rejected'));
  END IF;
END
$compat$;


ALTER TABLE historical_payroll_entries
  ADD COLUMN IF NOT EXISTS de_minimis_breakdown jsonb;
