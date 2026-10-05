CREATE TABLE IF NOT EXISTS payroll_month_closures (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  applicable_month varchar(7) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'certified',
  snapshot_hash varchar(64) NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  certified_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  certified_by_name varchar(120) NOT NULL,
  certified_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_month_closure_snapshot_unique
  ON payroll_month_closures(organization_id, applicable_month, snapshot_hash);

CREATE INDEX IF NOT EXISTS payroll_month_closure_status_idx
  ON payroll_month_closures(organization_id, applicable_month, status);
