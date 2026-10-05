CREATE TABLE IF NOT EXISTS "statutory_contribution_disputes" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "member_id" integer REFERENCES "statutory_remittance_members"("id") ON DELETE set null,
  "agency" varchar(16) NOT NULL,
  "applicable_month" varchar(7) NOT NULL,
  "issue_type" varchar(32) NOT NULL,
  "description" varchar(500) NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "reported_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "reported_by_name" varchar(120) NOT NULL,
  "resolution_code" varchar(32),
  "resolution_note" varchar(500),
  "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "resolved_by_name" varchar(120),
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "statutory_contribution_disputes_org_status_idx"
  ON "statutory_contribution_disputes" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_contribution_disputes_employee_month_idx"
  ON "statutory_contribution_disputes" ("employee_id", "applicable_month", "agency");
