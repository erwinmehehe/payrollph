CREATE TABLE IF NOT EXISTS shift_definitions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  start_time varchar(8) NOT NULL,
  end_time varchar(8) NOT NULL,
  break_minutes integer NOT NULL DEFAULT 60,
  spans_midnight boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_definitions_break_minutes_check CHECK (break_minutes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_definitions_org_code_unique
  ON shift_definitions(organization_id, code);
CREATE INDEX IF NOT EXISTS shift_definitions_org_active_idx
  ON shift_definitions(organization_id, active);

CREATE TABLE IF NOT EXISTS schedule_patterns (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  cycle_days integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_patterns_cycle_days_check CHECK (cycle_days BETWEEN 1 AND 56)
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_patterns_org_code_unique
  ON schedule_patterns(organization_id, code);
CREATE INDEX IF NOT EXISTS schedule_patterns_org_active_idx
  ON schedule_patterns(organization_id, active);

CREATE TABLE IF NOT EXISTS schedule_pattern_days (
  id serial PRIMARY KEY,
  pattern_id integer NOT NULL REFERENCES schedule_patterns(id) ON DELETE CASCADE,
  day_index integer NOT NULL,
  is_rest_day boolean NOT NULL DEFAULT false,
  label varchar(80),
  CONSTRAINT schedule_pattern_days_day_index_check CHECK (day_index BETWEEN 0 AND 55)
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_pattern_days_pattern_day_unique
  ON schedule_pattern_days(pattern_id, day_index);

CREATE TABLE IF NOT EXISTS schedule_pattern_segments (
  id serial PRIMARY KEY,
  pattern_day_id integer NOT NULL REFERENCES schedule_pattern_days(id) ON DELETE CASCADE,
  shift_definition_id integer NOT NULL REFERENCES shift_definitions(id) ON DELETE RESTRICT,
  segment_order integer NOT NULL DEFAULT 1,
  CONSTRAINT schedule_pattern_segments_order_check CHECK (segment_order >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_pattern_segments_day_order_unique
  ON schedule_pattern_segments(pattern_day_id, segment_order);

CREATE TABLE IF NOT EXISTS employee_schedule_assignments (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pattern_id integer NOT NULL REFERENCES schedule_patterns(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_until date,
  anchor_date date NOT NULL,
  work_location_org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
  reason varchar(240) NOT NULL DEFAULT 'Schedule assignment',
  created_by varchar(120) NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_schedule_assignments_dates_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX IF NOT EXISTS employee_schedule_assignments_employee_date_idx
  ON employee_schedule_assignments(employee_id, effective_from);
CREATE INDEX IF NOT EXISTS employee_schedule_assignments_org_idx
  ON employee_schedule_assignments(organization_id);

CREATE TABLE IF NOT EXISTS schedule_overrides (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  kind varchar(24) NOT NULL DEFAULT 'shift',
  is_rest_day boolean NOT NULL DEFAULT false,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  work_location_org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
  reason varchar(240) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'approved',
  created_by varchar(120) NOT NULL DEFAULT 'System',
  approved_by varchar(120),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_overrides_kind_check
    CHECK (kind IN ('shift', 'split_shift', 'rest_day', 'off', 'location')),
  CONSTRAINT schedule_overrides_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_overrides_employee_date_unique
  ON schedule_overrides(employee_id, work_date);
CREATE INDEX IF NOT EXISTS schedule_overrides_org_date_idx
  ON schedule_overrides(organization_id, work_date);
