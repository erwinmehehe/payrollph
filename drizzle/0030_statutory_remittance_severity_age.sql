ALTER TABLE "compliance_action_tasks"
  ADD COLUMN IF NOT EXISTS "severity_changed_at" timestamptz DEFAULT now() NOT NULL;
