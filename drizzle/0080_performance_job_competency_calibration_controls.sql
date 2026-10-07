-- HCM performance architecture: connect competencies to job-profile skill requirements
-- and govern calibration distribution/outlier review. No compensation or payroll mutation.

ALTER TABLE "performance_templates"
  ADD COLUMN IF NOT EXISTS "skill_id" integer REFERENCES "hcm_skills"("id") ON DELETE set null;

CREATE UNIQUE INDEX IF NOT EXISTS "performance_templates_org_skill_competency_unique"
  ON "performance_templates" ("organization_id","skill_id")
  WHERE "skill_id" IS NOT NULL AND "type" = 'competency';

ALTER TABLE "performance_review_items"
  ADD COLUMN IF NOT EXISTS "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "skill_id" integer REFERENCES "hcm_skills"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "expected_proficiency" integer,
  ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "weight" numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "performance_review_items"
  DROP CONSTRAINT IF EXISTS "performance_review_items_expected_proficiency_check";
ALTER TABLE "performance_review_items"
  ADD CONSTRAINT "performance_review_items_expected_proficiency_check"
    CHECK ("expected_proficiency" IS NULL OR ("expected_proficiency" >= 1 AND "expected_proficiency" <= 5));

ALTER TABLE "performance_review_items"
  DROP CONSTRAINT IF EXISTS "performance_review_items_weight_check";
ALTER TABLE "performance_review_items"
  ADD CONSTRAINT "performance_review_items_weight_check"
    CHECK ("weight" >= 0 AND "weight" <= 100);

CREATE INDEX IF NOT EXISTS "performance_review_items_skill_idx"
  ON "performance_review_items" ("organization_id","skill_id","job_profile_id");

ALTER TABLE "performance_calibration_sessions"
  ADD COLUMN IF NOT EXISTS "policy_version" integer,
  ADD COLUMN IF NOT EXISTS "policy_snapshot" jsonb;

CREATE TABLE IF NOT EXISTS "performance_calibration_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "version" integer NOT NULL DEFAULT 1,
  "minimum_manager_sample" integer NOT NULL DEFAULT 3,
  "manager_mean_deviation_threshold" numeric(4,2) NOT NULL DEFAULT 0.75,
  "high_rating_threshold" numeric(4,2) NOT NULL DEFAULT 4.50,
  "high_rating_share_threshold" numeric(5,2) NOT NULL DEFAULT 60.00,
  "low_rating_threshold" numeric(4,2) NOT NULL DEFAULT 2.00,
  "low_rating_share_threshold" numeric(5,2) NOT NULL DEFAULT 40.00,
  "large_score_change_threshold" numeric(4,2) NOT NULL DEFAULT 1.00,
  "require_flag_resolution" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_name" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_calibration_policy_manager_sample_check"
    CHECK ("minimum_manager_sample" >= 2 AND "minimum_manager_sample" <= 1000),
  CONSTRAINT "performance_calibration_policy_mean_threshold_check"
    CHECK ("manager_mean_deviation_threshold" >= 0.10 AND "manager_mean_deviation_threshold" <= 4.00),
  CONSTRAINT "performance_calibration_policy_high_rating_check"
    CHECK ("high_rating_threshold" >= 1 AND "high_rating_threshold" <= 5),
  CONSTRAINT "performance_calibration_policy_high_share_check"
    CHECK ("high_rating_share_threshold" >= 0 AND "high_rating_share_threshold" <= 100),
  CONSTRAINT "performance_calibration_policy_low_rating_check"
    CHECK ("low_rating_threshold" >= 1 AND "low_rating_threshold" <= 5),
  CONSTRAINT "performance_calibration_policy_low_share_check"
    CHECK ("low_rating_share_threshold" >= 0 AND "low_rating_share_threshold" <= 100),
  CONSTRAINT "performance_calibration_policy_large_change_check"
    CHECK ("large_score_change_threshold" >= 0.10 AND "large_score_change_threshold" <= 4.00)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_calibration_policies_org_unique"
  ON "performance_calibration_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "performance_calibration_policy_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "performance_calibration_policies"("id") ON DELETE restrict,
  "from_version" integer,
  "to_version" integer NOT NULL,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "performance_calibration_policy_events_org_idx"
  ON "performance_calibration_policy_events" ("organization_id","created_at");

CREATE TABLE IF NOT EXISTS "performance_calibration_flags" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "session_id" integer NOT NULL REFERENCES "performance_calibration_sessions"("id") ON DELETE cascade,
  "review_id" integer REFERENCES "performance_reviews"("id") ON DELETE cascade,
  "reviewer_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "flag_type" varchar(40) NOT NULL,
  "severity" varchar(16) NOT NULL DEFAULT 'warning',
  "title" varchar(180) NOT NULL,
  "detail" varchar(600) NOT NULL,
  "observed_value" numeric(8,2),
  "threshold_value" numeric(8,2),
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "resolution_note" text,
  "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "resolved_by_name" varchar(120),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_calibration_flags_type_check"
    CHECK ("flag_type" IN ('manager_mean_outlier','high_rating_concentration','low_rating_concentration','large_score_change')),
  CONSTRAINT "performance_calibration_flags_severity_check"
    CHECK ("severity" IN ('warning','blocker')),
  CONSTRAINT "performance_calibration_flags_status_check"
    CHECK ("status" IN ('open','accepted','resolved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_calibration_flags_unique"
  ON "performance_calibration_flags" ("session_id","flag_type","reviewer_user_id","review_id");
CREATE INDEX IF NOT EXISTS "performance_calibration_flags_status_idx"
  ON "performance_calibration_flags" ("organization_id","session_id","status");
