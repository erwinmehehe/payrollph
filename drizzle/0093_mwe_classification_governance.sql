CREATE TABLE IF NOT EXISTS employee_mwe_classifications (
  id serial PRIMARY KEY NOT NULL,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_mwe boolean NOT NULL,
  region varchar(32) NOT NULL,
  employee_daily_wage numeric(10,2) NOT NULL,
  statutory_minimum_wage numeric(10,2) NOT NULL,
  wage_order_reference varchar(160) NOT NULL,
  evidence_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  status varchar(24) NOT NULL DEFAULT 'pending',
  requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name varchar(120) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT NOW(),
  decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  decided_by_name varchar(120),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_mwe_classifications_status_check
    CHECK (status IN ('pending','approved','rejected','superseded')),
  CONSTRAINT employee_mwe_classifications_dates_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT employee_mwe_classifications_wages_check
    CHECK (employee_daily_wage > 0 AND statutory_minimum_wage > 0)
);

CREATE INDEX IF NOT EXISTS employee_mwe_classifications_employee_date_idx
  ON employee_mwe_classifications (organization_id, employee_id, effective_from);
CREATE INDEX IF NOT EXISTS employee_mwe_classifications_status_idx
  ON employee_mwe_classifications (organization_id, status, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS employee_mwe_classifications_open_effective_unique
  ON employee_mwe_classifications (employee_id, effective_from)
  WHERE status IN ('pending','approved');

CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
  ALTER TABLE employee_mwe_classifications
    ADD CONSTRAINT employee_mwe_classifications_no_approved_overlap
    EXCLUDE USING gist (
      employee_id WITH =,
      daterange(effective_from, COALESCE(effective_until, 'infinity'::date), '[]') WITH &&
    )
    WHERE (status = 'approved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $;
