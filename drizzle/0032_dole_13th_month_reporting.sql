CREATE TABLE IF NOT EXISTS dole_reporting_profiles (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  establishment_address text NOT NULL DEFAULT '',
  principal_business varchar(240) NOT NULL DEFAULT '',
  contact_name varchar(160) NOT NULL DEFAULT '',
  contact_position varchar(160) NOT NULL DEFAULT '',
  contact_phone varchar(48) NOT NULL DEFAULT '',
  updated_by varchar(120),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dole_compliance_submissions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type varchar(48) NOT NULL,
  report_year integer NOT NULL,
  report_hash varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'submitted',
  portal_reference varchar(160) NOT NULL,
  submitted_at timestamptz NOT NULL,
  recorded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dole_compliance_submission_snapshot_unique
  ON dole_compliance_submissions(organization_id, report_type, report_year, report_hash);

CREATE INDEX IF NOT EXISTS dole_compliance_submission_year_idx
  ON dole_compliance_submissions(organization_id, report_year, report_type);
