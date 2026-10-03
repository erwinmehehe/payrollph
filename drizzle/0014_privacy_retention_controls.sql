ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS privacy_restricted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS retention_rules (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_class varchar(48) NOT NULL,
  retention_years integer NOT NULL,
  disposal_action varchar(24) NOT NULL DEFAULT 'review_then_delete',
  legal_basis text NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  approved_by varchar(120) NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT NOW(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS retention_rules_org_class_unique
  ON retention_rules(organization_id, record_class);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_rules_years_check'
  ) THEN
    ALTER TABLE retention_rules
      ADD CONSTRAINT retention_rules_years_check
      CHECK (retention_years >= 1 AND retention_years <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_rules_disposal_check'
  ) THEN
    ALTER TABLE retention_rules
      ADD CONSTRAINT retention_rules_disposal_check
      CHECK (disposal_action IN ('review_then_delete', 'anonymize', 'archive'));
  END IF;
END
$compat$;
