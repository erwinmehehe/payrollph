CREATE TABLE IF NOT EXISTS first_payroll_journey_progress (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  step_owners jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  updated_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
