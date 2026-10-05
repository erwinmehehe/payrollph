CREATE TABLE IF NOT EXISTS labor_inspection_drills (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL,
  range_label varchar(120) NOT NULL,
  evidence_pack_sha256 varchar(64) NOT NULL,
  evidence_pack_version varchar(64) NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  high_findings integer NOT NULL DEFAULT 0,
  medium_findings integer NOT NULL DEFAULT 0,
  info_findings integer NOT NULL DEFAULT 0,
  recorded_exposure numeric(14,2) NOT NULL DEFAULT '0',
  screening_exposure numeric(14,2) NOT NULL DEFAULT '0',
  unowned_actionable integer NOT NULL DEFAULT 0,
  ready_to_close integer NOT NULL DEFAULT 0,
  blocker_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS labor_inspection_drills_org_created_idx
  ON labor_inspection_drills(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS labor_inspection_drills_status_idx
  ON labor_inspection_drills(organization_id, status);

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'labor_inspection_drills_status_check'
  ) THEN
    ALTER TABLE labor_inspection_drills
      ADD CONSTRAINT labor_inspection_drills_status_check
      CHECK (status IN ('blocked', 'needs-work', 'evidence-ready'));
  END IF;
END
$compat$;
