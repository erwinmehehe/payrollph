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
CREATE UNIQUE INDEX IF NOT EXISTS "statutory_contribution_disputes_open_unique"
  ON "statutory_contribution_disputes" ("organization_id", "employee_id", "agency", "applicable_month", "issue_type")
  WHERE "status" = 'open';


DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_disputes_status_check'
  ) THEN
    ALTER TABLE statutory_contribution_disputes
      ADD CONSTRAINT statutory_contribution_disputes_status_check
      CHECK (status IN ('open', 'resolved'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_disputes_agency_check'
  ) THEN
    ALTER TABLE statutory_contribution_disputes
      ADD CONSTRAINT statutory_contribution_disputes_agency_check
      CHECK (agency IN ('SSS', 'PhilHealth', 'Pag-IBIG'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_disputes_issue_check'
  ) THEN
    ALTER TABLE statutory_contribution_disputes
      ADD CONSTRAINT statutory_contribution_disputes_issue_check
      CHECK (issue_type IN ('missing_posting', 'wrong_amount', 'wrong_reference', 'other'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_disputes_resolution_check'
  ) THEN
    ALTER TABLE statutory_contribution_disputes
      ADD CONSTRAINT statutory_contribution_disputes_resolution_check
      CHECK (resolution_code IS NULL OR resolution_code IN ('posted_confirmed', 'corrected', 'not_an_error', 'duplicate'));
  END IF;
END
$compat$;
