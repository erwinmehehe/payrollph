-- HCM Core 3.0: governed employment terms and lifecycle dates.
-- Dates create review/action evidence; they never auto-regularize or auto-separate a worker.

CREATE TABLE IF NOT EXISTS "hcm_employment_terms" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "employment_type" varchar(32) NOT NULL,
  "term_kind" varchar(24) NOT NULL CHECK ("term_kind" IN ('regular','probationary','fixed_term','project','seasonal','casual','other')),
  "effective_from" date NOT NULL,
  "effective_until" date,
  "probation_review_date" date,
  "contract_end_date" date,
  "project_name" varchar(160),
  "status" varchar(24) NOT NULL DEFAULT 'pending_approval'
    CHECK ("status" IN ('pending_approval','scheduled','active','superseded','cancelled','failed')),
  "reason" varchar(240) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "superseded_at" timestamptz,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamptz,
  "failure" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_employment_terms_valid_range" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from"),
  CONSTRAINT "hcm_employment_terms_probation_review_range" CHECK ("probation_review_date" IS NULL OR "probation_review_date" >= "effective_from"),
  CONSTRAINT "hcm_employment_terms_contract_end_range" CHECK ("contract_end_date" IS NULL OR "contract_end_date" >= "effective_from")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employment_terms_active_employee_unique"
  ON "hcm_employment_terms" ("organization_id","employee_id")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employment_terms_open_employee_unique"
  ON "hcm_employment_terms" ("organization_id","employee_id")
  WHERE "status" IN ('pending_approval','scheduled');

CREATE INDEX IF NOT EXISTS "hcm_employment_terms_org_status_date_idx"
  ON "hcm_employment_terms" ("organization_id","status","effective_from");

CREATE INDEX IF NOT EXISTS "hcm_employment_terms_employee_history_idx"
  ON "hcm_employment_terms" ("organization_id","employee_id","effective_from");
