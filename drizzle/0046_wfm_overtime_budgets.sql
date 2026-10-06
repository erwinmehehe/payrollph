-- Governed monthly overtime budgets by organization unit
CREATE TABLE IF NOT EXISTS "overtime_budgets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE cascade,
  "period_month" varchar(7) NOT NULL,
  "budget_minutes" integer NOT NULL,
  "enforcement_mode" varchar(24) DEFAULT 'advisory' NOT NULL,
  "manager_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "active" boolean DEFAULT true NOT NULL,
  "notes" varchar(240),
  "updated_by" varchar(120) NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "overtime_budgets_period_month_check"
    CHECK ("period_month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "overtime_budgets_minutes_check"
    CHECK ("budget_minutes" >= 0 AND "budget_minutes" <= 1000000),
  CONSTRAINT "overtime_budgets_enforcement_check"
    CHECK ("enforcement_mode" IN ('advisory', 'block'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "overtime_budgets_org_unit_month_unique"
  ON "overtime_budgets" ("organization_id", "org_unit_id", "period_month");
CREATE INDEX IF NOT EXISTS "overtime_budgets_org_month_idx"
  ON "overtime_budgets" ("organization_id", "period_month", "active");
CREATE INDEX IF NOT EXISTS "overtime_budgets_manager_idx"
  ON "overtime_budgets" ("organization_id", "manager_user_id", "period_month");

ALTER TABLE "overtime_requests"
  ADD COLUMN IF NOT EXISTS "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null;
ALTER TABLE "overtime_requests"
  ADD COLUMN IF NOT EXISTS "budget_id" integer REFERENCES "overtime_budgets"("id") ON DELETE set null;
ALTER TABLE "overtime_requests"
  ADD COLUMN IF NOT EXISTS "budget_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE "overtime_requests" ot
SET "org_unit_id" = e."org_unit_id"
FROM "employees" e
WHERE ot."employee_id" = e."id"
  AND ot."organization_id" = e."organization_id"
  AND ot."org_unit_id" IS NULL;

CREATE INDEX IF NOT EXISTS "overtime_requests_org_unit_date_idx"
  ON "overtime_requests" ("organization_id", "org_unit_id", "work_date");
CREATE INDEX IF NOT EXISTS "overtime_requests_budget_idx"
  ON "overtime_requests" ("budget_id", "status");
