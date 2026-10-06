-- Governed WFM staffing scenarios and manager approval evidence
CREATE TABLE IF NOT EXISTS "workforce_planning_scenarios" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "name" varchar(160) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "scope_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "worksite_id" integer REFERENCES "worksites"("id") ON DELETE set null,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "demand_growth_percent" numeric(7,2) DEFAULT '0' NOT NULL,
  "vacancy_fill_percent" numeric(7,2) DEFAULT '100' NOT NULL,
  "employer_load_percent" numeric(7,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "snapshot_hash" varchar(64) NOT NULL,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "submitted_at" timestamptz,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(500),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workforce_scenarios_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected')),
  CONSTRAINT "workforce_scenarios_growth_check"
    CHECK ("demand_growth_percent" >= -50 AND "demand_growth_percent" <= 200),
  CONSTRAINT "workforce_scenarios_vacancy_fill_check"
    CHECK ("vacancy_fill_percent" >= 0 AND "vacancy_fill_percent" <= 100),
  CONSTRAINT "workforce_scenarios_employer_load_check"
    CHECK ("employer_load_percent" >= 0 AND "employer_load_percent" <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_scenarios_org_name_version_unique"
  ON "workforce_planning_scenarios" ("organization_id", "name", "version");
CREATE INDEX IF NOT EXISTS "workforce_scenarios_org_status_idx"
  ON "workforce_planning_scenarios" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "workforce_scenarios_org_unit_idx"
  ON "workforce_planning_scenarios" ("organization_id", "scope_org_unit_id");
CREATE INDEX IF NOT EXISTS "workforce_scenarios_plan_idx"
  ON "workforce_planning_scenarios" ("plan_id");
