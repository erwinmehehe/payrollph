CREATE TABLE IF NOT EXISTS "engagement_surveys" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(180) NOT NULL,
  "kind" varchar(32) DEFAULT 'pulse' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "anonymous" boolean DEFAULT true NOT NULL,
  "privacy_threshold" integer DEFAULT 5 NOT NULL,
  "audience_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "opens_at" timestamp with time zone,
  "closes_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_surveys_org_name_unique" ON "engagement_surveys" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "engagement_surveys_org_status_idx" ON "engagement_surveys" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "engagement_surveys_org_audience_idx" ON "engagement_surveys" ("organization_id","audience_org_unit_id");

CREATE TABLE IF NOT EXISTS "engagement_questions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "survey_id" integer NOT NULL REFERENCES "engagement_surveys"("id") ON DELETE cascade,
  "prompt" varchar(500) NOT NULL,
  "type" varchar(32) DEFAULT 'rating_1_5' NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "engagement_questions_survey_order_idx" ON "engagement_questions" ("survey_id","sort_order");
CREATE INDEX IF NOT EXISTS "engagement_questions_org_idx" ON "engagement_questions" ("organization_id");

CREATE TABLE IF NOT EXISTS "engagement_responses" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "survey_id" integer NOT NULL REFERENCES "engagement_surveys"("id") ON DELETE cascade,
  "respondent_key" text NOT NULL,
  "respondent_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "respondent_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "org_unit_id_snapshot" integer REFERENCES "org_units"("id") ON DELETE set null,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_responses_survey_respondent_unique" ON "engagement_responses" ("survey_id","respondent_key");
CREATE INDEX IF NOT EXISTS "engagement_responses_org_survey_idx" ON "engagement_responses" ("organization_id","survey_id");
CREATE INDEX IF NOT EXISTS "engagement_responses_survey_unit_idx" ON "engagement_responses" ("survey_id","org_unit_id_snapshot");

CREATE TABLE IF NOT EXISTS "engagement_answers" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "response_id" integer NOT NULL REFERENCES "engagement_responses"("id") ON DELETE cascade,
  "question_id" integer NOT NULL REFERENCES "engagement_questions"("id") ON DELETE cascade,
  "numeric_value" numeric(8,2),
  "text_value" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_answers_response_question_unique" ON "engagement_answers" ("response_id","question_id");
CREATE INDEX IF NOT EXISTS "engagement_answers_question_idx" ON "engagement_answers" ("question_id");

CREATE TABLE IF NOT EXISTS "engagement_action_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "survey_id" integer NOT NULL REFERENCES "engagement_surveys"("id") ON DELETE cascade,
  "question_id" integer REFERENCES "engagement_questions"("id") ON DELETE set null,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "owner_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "title" varchar(200) NOT NULL,
  "due_date" date,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "engagement_action_plans_org_status_idx" ON "engagement_action_plans" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "engagement_action_plans_survey_idx" ON "engagement_action_plans" ("survey_id");

CREATE TABLE IF NOT EXISTS "recognition_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "sender_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "recipient_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "category" varchar(48) DEFAULT 'appreciation' NOT NULL,
  "message" varchar(800) NOT NULL,
  "visible_to_everyone" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "recognition_events_org_created_idx" ON "recognition_events" ("organization_id","created_at");
CREATE INDEX IF NOT EXISTS "recognition_events_recipient_idx" ON "recognition_events" ("recipient_employee_id","created_at");

CREATE TABLE IF NOT EXISTS "continuous_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "author_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "recipient_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "kind" varchar(32) DEFAULT 'coaching' NOT NULL,
  "message" text NOT NULL,
  "visibility" varchar(32) DEFAULT 'manager_and_recipient' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "continuous_feedback_org_created_idx" ON "continuous_feedback" ("organization_id","created_at");
CREATE INDEX IF NOT EXISTS "continuous_feedback_recipient_idx" ON "continuous_feedback" ("recipient_employee_id","created_at");
