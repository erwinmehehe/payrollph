-- 0116: WFM roster scaling and employer-reviewed schedule-rule policy.
-- SOURCE ONLY. DO NOT APPLY IN PRODUCTION BEFORE DBA AND WFM ACCEPTANCE.
-- Run isolated migration rehearsal before turning WFM_ROSTER_SCALE_RULES_ENABLED on.
-- The indexed scan uses the existing assignment primary key as a keyset cursor.
CREATE TABLE IF NOT EXISTS workforce_roster_rule_policies (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  max_daily_minutes integer NOT NULL DEFAULT 720,
  max_rolling_seven_day_minutes integer NOT NULL DEFAULT 2880,
  min_rest_between_shifts_minutes integer NOT NULL DEFAULT 660,
  ordinary_daily_minutes integer NOT NULL DEFAULT 480,
  approved_overtime_cap_minutes integer NOT NULL DEFAULT 0,
  enforcement_mode varchar(16) NOT NULL DEFAULT 'block',
  updated_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfm_roster_rules_limits_check CHECK (
    max_daily_minutes BETWEEN 480 AND 1440
    AND max_rolling_seven_day_minutes BETWEEN 480 AND 10080
    AND min_rest_between_shifts_minutes BETWEEN 0 AND 1440
    AND ordinary_daily_minutes BETWEEN 480 AND 720
    AND approved_overtime_cap_minutes BETWEEN 0 AND 10080
    AND enforcement_mode IN ('block', 'advisory')
  )
);
CREATE INDEX IF NOT EXISTS wfm_roster_rules_org_idx ON workforce_roster_rule_policies (organization_id);
-- Page-local assignment intersection reads should not scan expired history.
CREATE INDEX IF NOT EXISTS wfm_schedule_assignment_effective_window_idx
  ON employee_schedule_assignments (organization_id, employee_id, effective_from, effective_until);
CREATE INDEX IF NOT EXISTS wfm_worksite_assignment_effective_window_idx
  ON employee_worksite_assignments (organization_id, employee_id, effective_from, effective_until);
