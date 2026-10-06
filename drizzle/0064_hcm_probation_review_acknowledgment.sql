-- HCM Core 3.8: structured probation reviews and employee receipt acknowledgments.
-- Reviews are evidence/recommendations only. They never approve or change employment status by themselves.

CREATE TABLE IF NOT EXISTS "hcm_probation_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "employment_term_id" integer NOT NULL REFERENCES "hcm_employment_terms"("id") ON DELETE restrict,
  "status" varchar(24) NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft','submitted')),
  "recommendation" varchar(32)
    CHECK ("recommendation" IS NULL OR "recommendation" IN ('confirm_regular','non_renew','needs_hr_review')),
  "overall_rating" integer CHECK ("overall_rating" IS NULL OR "overall_rating" BETWEEN 1 AND 5),
  "role_expectations_rating" integer CHECK ("role_expectations_rating" IS NULL OR "role_expectations_rating" BETWEEN 1 AND 5),
  "work_quality_rating" integer CHECK ("work_quality_rating" IS NULL OR "work_quality_rating" BETWEEN 1 AND 5),
  "reliability_rating" integer CHECK ("reliability_rating" IS NULL OR "reliability_rating" BETWEEN 1 AND 5),
  "conduct_collaboration_rating" integer CHECK ("conduct_collaboration_rating" IS NULL OR "conduct_collaboration_rating" BETWEEN 1 AND 5),
  "summary" text,
  "strengths" text,
  "development_areas" text,
  "reviewer_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "reviewer_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "reviewer_name" varchar(120) NOT NULL,
  "submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_probation_reviews_term_unique"
  ON "hcm_probation_reviews" ("organization_id","employment_term_id");

CREATE INDEX IF NOT EXISTS "hcm_probation_reviews_employee_idx"
  ON "hcm_probation_reviews" ("organization_id","employee_id","status");

CREATE TABLE IF NOT EXISTS "hcm_probation_review_acknowledgments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "hcm_probation_reviews"("id") ON DELETE restrict,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "response" varchar(32) NOT NULL DEFAULT 'acknowledged_receipt'
    CHECK ("response" = 'acknowledged_receipt'),
  "employee_comment" text,
  "statement_version" varchar(40) NOT NULL DEFAULT 'receipt-only-v1',
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "acknowledged_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_probation_review_ack_unique"
  ON "hcm_probation_review_acknowledgments" ("review_id","employee_id");

CREATE INDEX IF NOT EXISTS "hcm_probation_review_ack_employee_idx"
  ON "hcm_probation_review_acknowledgments" ("organization_id","employee_id","created_at");

CREATE TABLE IF NOT EXISTS "hcm_probation_review_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "hcm_probation_reviews"("id") ON DELETE restrict,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_probation_review_events_review_idx"
  ON "hcm_probation_review_events" ("organization_id","review_id","created_at");
