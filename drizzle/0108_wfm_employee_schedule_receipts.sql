-- Schedule-content receipts only. No attendance, pay, notification or employee updates.
-- Apply only through an independently reviewed migration process; runtime flag defaults OFF.
CREATE TABLE IF NOT EXISTS workforce_schedule_receipts (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id),
  acknowledged_by_user_id integer NOT NULL REFERENCES users(id),
  work_date date NOT NULL,
  snapshot_hash varchar(64) NOT NULL,
  snapshot jsonb NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfm_schedule_receipt_hash_check CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT wfm_schedule_receipt_snapshot_check CHECK (coalesce(
    jsonb_typeof(snapshot) = 'object' AND snapshot->>'version' = '1'
    AND snapshot->>'date' = work_date::text, false
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS wfm_schedule_receipt_content_unique
  ON workforce_schedule_receipts(organization_id, employee_id, acknowledged_by_user_id, work_date, snapshot_hash);
CREATE INDEX IF NOT EXISTS wfm_schedule_receipt_employee_date_idx
  ON workforce_schedule_receipts(organization_id, employee_id, work_date);
