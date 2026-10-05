CREATE TABLE IF NOT EXISTS labor_inspection_remediations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_key varchar(220) NOT NULL,
  rule_code varchar(80) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'open',
  owner varchar(120),
  acknowledged_by varchar(120),
  acknowledged_at timestamptz,
  resolution_note text,
  evidence_reference varchar(240),
  resolved_by varchar(120),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS labor_inspection_remediation_unique
  ON labor_inspection_remediations(organization_id, finding_key);

CREATE INDEX IF NOT EXISTS labor_inspection_remediation_status_idx
  ON labor_inspection_remediations(organization_id, status);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'labor_inspection_remediations_status_check'
  ) THEN
    ALTER TABLE labor_inspection_remediations
      ADD CONSTRAINT labor_inspection_remediations_status_check
      CHECK (status IN ('open', 'acknowledged', 'resolved'));
  END IF;
END
$compat$;
