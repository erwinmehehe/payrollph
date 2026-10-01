CREATE TABLE IF NOT EXISTS government_filing_validations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  agency varchar(16) NOT NULL,
  form varchar(24) NOT NULL,
  period_label varchar(80) NOT NULL,
  file_name varchar(160) NOT NULL,
  file_sha256 varchar(64) NOT NULL,
  generator_version varchar(48) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'generated',
  submission_method varchar(16),
  agency_reference varchar(80),
  submitted_at timestamptz,
  outcome_note text,
  generated_by varchar(120) NOT NULL,
  recorded_by varchar(120),
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS government_filing_file_unique
  ON government_filing_validations(organization_id, agency, form, file_sha256);

CREATE INDEX IF NOT EXISTS government_filing_status_idx
  ON government_filing_validations(agency, form, status);
