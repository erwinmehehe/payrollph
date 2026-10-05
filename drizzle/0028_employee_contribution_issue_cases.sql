CREATE TABLE IF NOT EXISTS "statutory_contribution_issue_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "batch_id" integer REFERENCES "statutory_remittance_batches"("id") ON DELETE set null,
  "remittance_member_id" integer REFERENCES "statutory_remittance_members"("id") ON DELETE set null,
  "agency" varchar(24) NOT NULL,
  "applicable_month" varchar(7) NOT NULL,
  "issue_type" varchar(48) NOT NULL,
  "description" varchar(500) NOT NULL,
  "employee_snapshot" jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "reported_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "reported_by_name" varchar(120) NOT NULL,
  "assigned_to_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "assigned_to_name" varchar(120),
  "review_started_at" timestamptz,
  "resolution_outcome" varchar(48),
  "resolution_note" varchar(600),
  "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "resolved_by_name" varchar(120),
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_org_status_idx"
  ON "statutory_contribution_issue_cases" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_employee_idx"
  ON "statutory_contribution_issue_cases" ("organization_id", "employee_id", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_member_idx"
  ON "statutory_contribution_issue_cases" ("organization_id", "remittance_member_id");
