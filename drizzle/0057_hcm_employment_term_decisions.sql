-- HCM Core 3.1: explicit employment-term decisions and governed separation handoff.
-- Decisions never auto-regularize, auto-renew, or auto-separate a worker.

CREATE TABLE IF NOT EXISTS "hcm_employment_term_decisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "employment_term_id" integer NOT NULL REFERENCES "hcm_employment_terms"("id") ON DELETE restrict,
  "decision_kind" varchar(32) NOT NULL CHECK (
    "decision_kind" IN ('confirm_regular','renew_term','extend_term','convert_terms','non_renew','continue_current')
  ),
  "effective_date" date NOT NULL,
  "next_employment_type" varchar(32),
  "next_term_kind" varchar(24),
  "next_effective_until" date,
  "next_probation_review_date" date,
  "next_contract_end_date" date,
  "next_project_name" varchar(160),
  "proposed_separation_last_day" date,
  "separation_reason" varchar(160),
  "status" varchar(24) NOT NULL DEFAULT 'pending_approval'
    CHECK ("status" IN ('pending_approval','scheduled','applied','cancelled','failed')),
  "separation_handoff_status" varchar(24) NOT NULL DEFAULT 'none'
    CHECK ("separation_handoff_status" IN ('none','ready','started','completed')),
  "reason" varchar(240) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamptz,
  "applied_at" timestamptz,
  "successor_term_id" integer REFERENCES "hcm_employment_terms"("id") ON DELETE set null,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamptz,
  "failure" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_employment_term_decision_valid_next_range" CHECK (
    "next_effective_until" IS NULL OR "next_effective_until" >= "effective_date"
  ),
  CONSTRAINT "hcm_employment_term_decision_valid_probation_review" CHECK (
    "next_probation_review_date" IS NULL OR "next_probation_review_date" >= "effective_date"
  ),
  CONSTRAINT "hcm_employment_term_decision_valid_contract_end" CHECK (
    "next_contract_end_date" IS NULL OR "next_contract_end_date" >= "effective_date"
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employment_term_decisions_open_term_unique"
  ON "hcm_employment_term_decisions" ("employment_term_id")
  WHERE "status" IN ('pending_approval','scheduled');

CREATE INDEX IF NOT EXISTS "hcm_employment_term_decisions_org_status_date_idx"
  ON "hcm_employment_term_decisions" ("organization_id","status","effective_date");

CREATE INDEX IF NOT EXISTS "hcm_employment_term_decisions_employee_history_idx"
  ON "hcm_employment_term_decisions" ("organization_id","employee_id","created_at");
