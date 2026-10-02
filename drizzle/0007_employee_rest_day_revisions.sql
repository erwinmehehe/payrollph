CREATE TABLE IF NOT EXISTS employee_rest_day_revisions (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  previous_rest_day varchar(10),
  new_rest_day varchar(10),
  reason varchar(240) NOT NULL DEFAULT 'Work schedule change',
  created_by varchar(120) NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_rest_day_revisions_org_employee_idx
  ON employee_rest_day_revisions(organization_id, employee_id);

CREATE UNIQUE INDEX IF NOT EXISTS employee_rest_day_revisions_employee_effective_idx
  ON employee_rest_day_revisions(employee_id, effective_date);
