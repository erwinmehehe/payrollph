-- Published headcount plan baselines and plan-vs-actual evidence
CREATE TABLE IF NOT EXISTS "workforce_plan_baselines" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "workforce_plans"("id") ON DELETE cascade,
  "scenario_id" integer NOT NULL REFERENCES "workforce_planning_scenarios"("id") ON DELETE restrict,
  "version" integer DEFAULT 1 NOT NULL,
  "scope_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "worksite_id" integer REFERENCES "worksites"("id") ON DELETE set null,
  "current" boolean DEFAULT true NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "snapshot_hash" varchar(64) NOT NULL,
  "published_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "published_by" varchar(120) NOT NULL,
  "published_at" timestamptz DEFAULT now() NOT NULL,
  "superseded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plan_baselines_plan_version_unique"
  ON "workforce_plan_baselines" ("plan_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plan_baselines_scenario_unique"
  ON "workforce_plan_baselines" ("organization_id", "scenario_id");
CREATE INDEX IF NOT EXISTS "workforce_plan_baselines_current_idx"
  ON "workforce_plan_baselines" ("organization_id", "current", "plan_id");
CREATE INDEX IF NOT EXISTS "workforce_plan_baselines_scope_idx"
  ON "workforce_plan_baselines" ("organization_id", "scope_org_unit_id", "current");
CREATE INDEX IF NOT EXISTS "workforce_plan_baselines_published_idx"
  ON "workforce_plan_baselines" ("organization_id", "published_at");
