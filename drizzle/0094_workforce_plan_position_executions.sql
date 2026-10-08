CREATE TABLE IF NOT EXISTS "workforce_plan_position_executions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "workforce_plans"("id") ON DELETE cascade,
  "baseline_id" integer NOT NULL REFERENCES "workforce_plan_baselines"("id") ON DELETE restrict,
  "baseline_snapshot_hash" varchar(64) NOT NULL,
  "status" varchar(24) DEFAULT 'preview' NOT NULL,
  "execution_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "execution_hash" varchar(64) NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "applied_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "applied_by" varchar(120),
  "applied_at" timestamptz,
  CONSTRAINT "workforce_plan_position_executions_status_check"
    CHECK ("status" IN ('preview', 'applied', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plan_position_executions_org_hash_unique"
  ON "workforce_plan_position_executions" ("organization_id", "execution_hash");
CREATE INDEX IF NOT EXISTS "workforce_plan_position_executions_plan_status_idx"
  ON "workforce_plan_position_executions" ("organization_id", "plan_id", "status");
CREATE INDEX IF NOT EXISTS "workforce_plan_position_executions_baseline_idx"
  ON "workforce_plan_position_executions" ("baseline_id");
