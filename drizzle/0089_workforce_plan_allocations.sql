CREATE TABLE IF NOT EXISTS "workforce_plan_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "plan_id" integer NOT NULL REFERENCES "workforce_plans"("id") ON DELETE CASCADE,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE RESTRICT,
  "headcount_ceiling" integer DEFAULT 0 NOT NULL,
  "annual_budget_ceiling" numeric(14,2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workforce_plan_allocations_headcount_check" CHECK ("headcount_ceiling" >= 0),
  CONSTRAINT "workforce_plan_allocations_budget_check" CHECK ("annual_budget_ceiling" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plan_allocations_plan_unit_unique"
  ON "workforce_plan_allocations" ("plan_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "workforce_plan_allocations_org_plan_idx"
  ON "workforce_plan_allocations" ("organization_id","plan_id");
CREATE INDEX IF NOT EXISTS "workforce_plan_allocations_unit_idx"
  ON "workforce_plan_allocations" ("organization_id","org_unit_id");

CREATE TABLE IF NOT EXISTS "workforce_plan_manager_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "plan_id" integer NOT NULL REFERENCES "workforce_plans"("id") ON DELETE CASCADE,
  "allocation_id" integer NOT NULL REFERENCES "workforce_plan_allocations"("id") ON DELETE RESTRICT,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE RESTRICT,
  "version" integer DEFAULT 1 NOT NULL,
  "requested_headcount" integer DEFAULT 0 NOT NULL,
  "requested_annual_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "rationale" text NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "allocation_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" timestamp with time zone,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workforce_plan_manager_submissions_headcount_check" CHECK ("requested_headcount" >= 0),
  CONSTRAINT "workforce_plan_manager_submissions_budget_check" CHECK ("requested_annual_budget" >= 0),
  CONSTRAINT "workforce_plan_manager_submissions_status_check"
    CHECK ("status" IN ('draft','submitted','accepted','rejected','superseded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plan_manager_submissions_plan_unit_version_unique"
  ON "workforce_plan_manager_submissions" ("plan_id","org_unit_id","version");
CREATE INDEX IF NOT EXISTS "workforce_plan_manager_submissions_org_status_idx"
  ON "workforce_plan_manager_submissions" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "workforce_plan_manager_submissions_allocation_idx"
  ON "workforce_plan_manager_submissions" ("allocation_id","status");
CREATE INDEX IF NOT EXISTS "workforce_plan_manager_submissions_unit_idx"
  ON "workforce_plan_manager_submissions" ("organization_id","org_unit_id","status");
