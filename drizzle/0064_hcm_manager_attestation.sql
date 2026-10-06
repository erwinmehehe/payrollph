-- HCM Core 3.8: governed manager attestations for employment decisions.
-- Attestations are append-only evidence. They do not approve, apply, renew, regularize, or separate workers.

CREATE TABLE IF NOT EXISTS "hcm_employment_decision_manager_attestations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "decision_id" integer NOT NULL REFERENCES "hcm_employment_term_decisions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "worker_position_assignment_id" integer NOT NULL REFERENCES "position_assignments"("id") ON DELETE restrict,
  "worker_position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE restrict,
  "manager_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE restrict,
  "manager_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "manager_name" varchar(120) NOT NULL,
  "recommendation" varchar(32) NOT NULL
    CHECK ("recommendation" IN ('support','do_not_support','needs_more_review')),
  "statement" text NOT NULL,
  "reporting_line_snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_decision_manager_attestations_decision_idx"
  ON "hcm_employment_decision_manager_attestations" ("organization_id","decision_id","created_at");

CREATE INDEX IF NOT EXISTS "hcm_decision_manager_attestations_manager_idx"
  ON "hcm_employment_decision_manager_attestations" ("organization_id","manager_employee_id","created_at");
