ALTER TABLE "automation_executions"
  ADD COLUMN IF NOT EXISTS "workflow" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "cursor" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "resume_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "waiting_approval_task_id" integer,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE "automation_executions"
  ALTER COLUMN "result" SET DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "automation_executions_resume_idx"
  ON "automation_executions" ("status", "resume_at");

CREATE INDEX IF NOT EXISTS "automation_executions_approval_idx"
  ON "automation_executions" ("waiting_approval_task_id");
