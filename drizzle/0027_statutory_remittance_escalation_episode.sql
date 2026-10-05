ALTER TABLE "compliance_action_tasks"
  ADD COLUMN IF NOT EXISTS "escalation_episode" integer DEFAULT 1 NOT NULL;
