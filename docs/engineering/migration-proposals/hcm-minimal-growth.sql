-- DESIGN PROPOSAL ONLY. NOT AN APPLIED OR NUMBERED MIGRATION.
-- Obtain DBA-assigned next consecutive SQL number after canonical 0115-0119 train.
-- Must be rehearsed on a disposable schema and reviewed for tenant/privacy scope.
-- Optional employee engagement and goals. Source merge never applies migrations.
CREATE TABLE IF NOT EXISTS "hcm_pulse_surveys" (
 "id" serial PRIMARY KEY,
 "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "question" varchar(240) NOT NULL,
 "status" varchar(16) NOT NULL DEFAULT 'open',
 "created_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 -- Individual response scores and pseudonyms are deleted when sealing a survey.
 "aggregate_count" integer,
 "aggregate_average" numeric(4,2),
 "aggregate_distribution" jsonb,
 "closed_at" timestamptz,
 CONSTRAINT "hcm_pulse_aggregate_privacy_check" CHECK
  (("aggregate_count" IS NULL AND "aggregate_average" IS NULL AND "aggregate_distribution" IS NULL)
    OR ("aggregate_count" >= 5 AND "aggregate_average" BETWEEN 1 AND 5
      AND jsonb_typeof("aggregate_distribution") = 'array'
      AND jsonb_array_length("aggregate_distribution") = 5)),
 CONSTRAINT "hcm_pulse_survey_status_check" CHECK ("status" IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS "hcm_pulse_org_status_idx" ON "hcm_pulse_surveys" ("organization_id","status");
CREATE TABLE IF NOT EXISTS "hcm_pulse_survey_responses" (
 "id" serial PRIMARY KEY,
 "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "survey_id" integer NOT NULL REFERENCES "hcm_pulse_surveys"("id") ON DELETE CASCADE,
 "respondent_hash" varchar(64) NOT NULL,
 "score" integer NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "hcm_pulse_response_score_check" CHECK ("score" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_pulse_respondent_unique" ON "hcm_pulse_survey_responses" ("survey_id","respondent_hash");
CREATE INDEX IF NOT EXISTS "hcm_pulse_org_survey_idx" ON "hcm_pulse_survey_responses" ("organization_id","survey_id");
CREATE TABLE IF NOT EXISTS "hcm_simple_goals" (
 "id" serial PRIMARY KEY,
 "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
 "title" varchar(180) NOT NULL,
 "description" text NOT NULL,
 "due_date" date NOT NULL,
 "status" varchar(24) NOT NULL DEFAULT 'active',
 "created_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
 "review_score" integer,
 "review_notes" varchar(1000),
 "reviewer_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
 "reviewed_at" timestamptz,
 "employee_acknowledged_at" timestamptz,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "hcm_simple_goal_status_check" CHECK ("status" IN ('active','reviewed','acknowledged')),
 CONSTRAINT "hcm_simple_goal_review_check" CHECK ("review_score" IS NULL OR "review_score" BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS "hcm_simple_goals_org_employee_idx" ON "hcm_simple_goals" ("organization_id","employee_id");
