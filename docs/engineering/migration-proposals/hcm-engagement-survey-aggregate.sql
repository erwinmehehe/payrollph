-- #1031 / 2026-10-17: current-schema source-only review reconciliation.
-- These are unnumbered proposals, NOT applied migrations or DBA approval.
-- B-14: opted-in engagement survey. Answers are aggregate-only, never person rows.
-- Apply with the reviewed migration runner; a source merge does not run SQL.
CREATE TABLE IF NOT EXISTS "engagement_surveys" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL CONSTRAINT "engagement_surveys_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE CASCADE,
  "question" varchar(240) NOT NULL,
  "status" varchar(12) NOT NULL DEFAULT 'open',
  "response_count" integer NOT NULL DEFAULT 0,
  "score_sum" integer NOT NULL DEFAULT 0,
  "created_by_user_id" integer CONSTRAINT "engagement_surveys_created_by_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE SET NULL,
  "opened_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone,
  CONSTRAINT "engagement_surveys_status_check" CHECK (status IN ('open', 'closed')),
  CONSTRAINT "engagement_surveys_aggregate_check" CHECK (
    response_count >= 0 AND score_sum >= response_count AND score_sum <= response_count * 5
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_surveys_one_open_per_org"
  ON "engagement_surveys" ("organization_id") WHERE status = 'open';
CREATE INDEX IF NOT EXISTS "engagement_surveys_org_status_idx"
  ON "engagement_surveys" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "engagement_survey_participants" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL CONSTRAINT "engagement_survey_participants_organization_id_organizations_id" REFERENCES "organizations"("id") ON DELETE CASCADE,
  "survey_id" integer NOT NULL CONSTRAINT "engagement_survey_participants_survey_id_engagement_surveys_id_" REFERENCES "engagement_surveys"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL CONSTRAINT "engagement_survey_participants_employee_id_employees_id_fk" REFERENCES "employees"("id") ON DELETE CASCADE
);
-- No rating and no timestamp on participant rows. Only survey aggregate holds ratings.
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_survey_participants_one_per_worker"
  ON "engagement_survey_participants" ("survey_id", "employee_id");
CREATE INDEX IF NOT EXISTS "engagement_survey_participants_org_idx"
  ON "engagement_survey_participants" ("organization_id", "survey_id");
