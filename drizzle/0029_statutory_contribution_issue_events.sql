CREATE TABLE IF NOT EXISTS "statutory_contribution_issue_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "case_id" integer NOT NULL REFERENCES "statutory_contribution_issue_cases"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "visibility" varchar(24) DEFAULT 'employee' NOT NULL,
  "message" varchar(1000) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_event_case_idx"
  ON "statutory_contribution_issue_events" ("organization_id", "case_id", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_contribution_issue_event_employee_idx"
  ON "statutory_contribution_issue_events" ("organization_id", "employee_id", "created_at");

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_type_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_type_check"
      CHECK ("event_type" IN ('reported', 'review_started', 'payroll_update', 'resolved'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_visibility_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_visibility_check"
      CHECK ("visibility" IN ('employee', 'internal'));
  END IF;
END
$compat$;
