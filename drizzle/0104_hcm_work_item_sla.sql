-- HCM operational ownership and SLA tracking
-- Apply before enabling /api/hcm/work-items and the escalation sweep.
ALTER TABLE automation_operational_cases
  ADD COLUMN IF NOT EXISTS assigned_owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_escalate_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS automation_cases_sla_due_idx
  ON automation_operational_cases (organization_id, sla_due_at)
  WHERE status <> 'resolved' AND sla_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_cases_owner_idx
  ON automation_operational_cases (organization_id, assigned_owner_user_id, status);
CREATE TABLE IF NOT EXISTS hcm_work_item_events (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id integer NOT NULL REFERENCES automation_operational_cases(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  previous_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hcm_work_item_events_case_idx
  ON hcm_work_item_events (organization_id, case_id, created_at DESC);
