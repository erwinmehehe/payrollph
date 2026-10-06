-- Enterprise WFM overtime budget controls
CREATE TABLE IF NOT EXISTS "overtime_budget_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE cascade,
  "manager_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "scope_key" varchar(120) NOT NULL,
  "month_start" date NOT NULL,
  "budget_minutes" integer NOT NULL DEFAULT 0,
  "enforcement_mode" varchar(24) NOT NULL DEFAULT 'advisory',
  "active" boolean NOT NULL DEFAULT true,
  "updated_by" varchar(120) NOT NULL DEFAULT 'System',
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "overtime_budget_minutes_check" CHECK ("budget_minutes" >= 0 AND "budget_minutes" <= 1000000),
  CONSTRAINT "overtime_budget_mode_check" CHECK ("enforcement_mode" IN ('advisory', 'blocking'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "overtime_budget_scope_month_unique"
  ON "overtime_budget_policies" ("organization_id", "scope_key", "month_start");
CREATE INDEX IF NOT EXISTS "overtime_budget_org_month_idx"
  ON "overtime_budget_policies" ("organization_id", "month_start");
CREATE INDEX IF NOT EXISTS "overtime_budget_org_unit_idx"
  ON "overtime_budget_policies" ("organization_id", "org_unit_id");
