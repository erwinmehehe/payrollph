-- WFM overtime budget controls and decision evidence
CREATE TABLE IF NOT EXISTS "workforce_overtime_budgets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE cascade,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "budget_minutes" integer NOT NULL,
  "warning_threshold_percent" integer NOT NULL DEFAULT 80,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" varchar(120) NOT NULL DEFAULT 'System',
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workforce_overtime_budgets_dates_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "workforce_overtime_budgets_minutes_check" CHECK ("budget_minutes" >= 0),
  CONSTRAINT "workforce_overtime_budgets_warning_check" CHECK ("warning_threshold_percent" BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "workforce_overtime_budgets_unit_period_unique"
  ON "workforce_overtime_budgets" ("organization_id", "org_unit_id", "period_start", "period_end");
CREATE INDEX IF NOT EXISTS "workforce_overtime_budgets_org_period_idx"
  ON "workforce_overtime_budgets" ("organization_id", "period_start", "period_end");
CREATE INDEX IF NOT EXISTS "workforce_overtime_budgets_unit_active_idx"
  ON "workforce_overtime_budgets" ("organization_id", "org_unit_id", "active");

ALTER TABLE "overtime_requests"
  ADD COLUMN IF NOT EXISTS "budget_id" integer REFERENCES "workforce_overtime_budgets"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "budget_minutes_at_decision" integer,
  ADD COLUMN IF NOT EXISTS "budget_approved_minutes_before" integer,
  ADD COLUMN IF NOT EXISTS "budget_override_reason" varchar(240);

CREATE INDEX IF NOT EXISTS "overtime_requests_budget_idx"
  ON "overtime_requests" ("organization_id", "budget_id");
