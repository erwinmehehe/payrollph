-- Broader HCM performance structure: cascading goals, structured competency/KRA
-- templates, review evidence items, and governed cycle completion.

ALTER TABLE "performance_cycles"
  ADD COLUMN IF NOT EXISTS "require_self_assessment" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "require_manager_summary" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "completed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

ALTER TABLE "performance_goals"
  ALTER COLUMN "employee_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "scope" varchar(24) NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "parent_goal_id" integer REFERENCES "performance_goals"("id") ON DELETE set null;

ALTER TABLE "performance_goals"
  DROP CONSTRAINT IF EXISTS "performance_goals_scope_check";
ALTER TABLE "performance_goals"
  ADD CONSTRAINT "performance_goals_scope_check"
  CHECK (
    ("scope" = 'company' AND "employee_id" IS NULL AND "org_unit_id" IS NULL)
    OR ("scope" = 'team' AND "employee_id" IS NULL AND "org_unit_id" IS NOT NULL)
    OR ("scope" = 'employee' AND "employee_id" IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS "performance_goals_parent_idx"
  ON "performance_goals" ("organization_id","parent_goal_id");
CREATE INDEX IF NOT EXISTS "performance_goals_scope_idx"
  ON "performance_goals" ("organization_id","cycle_id","scope","org_unit_id");

CREATE TABLE IF NOT EXISTS "performance_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(60) NOT NULL,
  "name" varchar(180) NOT NULL,
  "type" varchar(24) NOT NULL,
  "description" text,
  "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE set null,
  "default_weight" numeric(5,2) NOT NULL DEFAULT '0',
  "rating_anchors" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_templates_type_check" CHECK ("type" IN ('competency','kra')),
  CONSTRAINT "performance_templates_weight_check" CHECK ("default_weight" >= 0 AND "default_weight" <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_templates_org_code_unique"
  ON "performance_templates" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "performance_templates_org_type_idx"
  ON "performance_templates" ("organization_id","type","active");

CREATE TABLE IF NOT EXISTS "performance_cycle_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE cascade,
  "template_id" integer NOT NULL REFERENCES "performance_templates"("id") ON DELETE cascade,
  "weight" numeric(5,2) NOT NULL DEFAULT '0',
  "required" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_cycle_templates_weight_check" CHECK ("weight" >= 0 AND "weight" <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_cycle_templates_unique"
  ON "performance_cycle_templates" ("cycle_id","template_id");
CREATE INDEX IF NOT EXISTS "performance_cycle_templates_org_cycle_idx"
  ON "performance_cycle_templates" ("organization_id","cycle_id");

CREATE TABLE IF NOT EXISTS "performance_review_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "performance_reviews"("id") ON DELETE cascade,
  "template_id" integer NOT NULL REFERENCES "performance_templates"("id") ON DELETE restrict,
  "self_score" numeric(4,2),
  "manager_score" numeric(4,2),
  "final_score" numeric(4,2),
  "employee_comment" text,
  "manager_comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_review_items_self_score_check" CHECK ("self_score" IS NULL OR ("self_score" >= 1 AND "self_score" <= 5)),
  CONSTRAINT "performance_review_items_manager_score_check" CHECK ("manager_score" IS NULL OR ("manager_score" >= 1 AND "manager_score" <= 5)),
  CONSTRAINT "performance_review_items_final_score_check" CHECK ("final_score" IS NULL OR ("final_score" >= 1 AND "final_score" <= 5))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_review_items_unique"
  ON "performance_review_items" ("review_id","template_id");
CREATE INDEX IF NOT EXISTS "performance_review_items_org_review_idx"
  ON "performance_review_items" ("organization_id","review_id");
