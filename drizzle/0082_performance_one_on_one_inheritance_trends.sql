-- HCM performance continuity: employee 1:1 agenda contributions,
-- inherited competency expectations, and review evidence provenance.

CREATE TABLE IF NOT EXISTS "hcm_skill_expectation_defaults" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_family_id" integer REFERENCES "job_families"("id") ON DELETE cascade,
  "job_level_id" integer REFERENCES "job_levels"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "hcm_skills"("id") ON DELETE restrict,
  "minimum_proficiency" integer NOT NULL DEFAULT 1,
  "mandatory" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_skill_expectation_defaults_scope_check"
    CHECK ("job_family_id" IS NOT NULL OR "job_level_id" IS NOT NULL),
  CONSTRAINT "hcm_skill_expectation_defaults_proficiency_check"
    CHECK ("minimum_proficiency" >= 1 AND "minimum_proficiency" <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_skill_expectation_defaults_scope_unique"
  ON "hcm_skill_expectation_defaults" (
    "organization_id",
    COALESCE("job_family_id", 0),
    COALESCE("job_level_id", 0),
    "skill_id"
  );

CREATE INDEX IF NOT EXISTS "hcm_skill_expectation_defaults_family_idx"
  ON "hcm_skill_expectation_defaults" ("organization_id","job_family_id","active");

CREATE INDEX IF NOT EXISTS "hcm_skill_expectation_defaults_level_idx"
  ON "hcm_skill_expectation_defaults" ("organization_id","job_level_id","active");

ALTER TABLE "performance_review_items"
  ADD COLUMN IF NOT EXISTS "expectation_source" varchar(24),
  ADD COLUMN IF NOT EXISTS "expectation_rule_id" integer REFERENCES "hcm_skill_expectation_defaults"("id") ON DELETE set null;

ALTER TABLE "performance_review_items"
  DROP CONSTRAINT IF EXISTS "performance_review_items_expectation_source_check";

ALTER TABLE "performance_review_items"
  ADD CONSTRAINT "performance_review_items_expectation_source_check"
    CHECK (
      "expectation_source" IS NULL
      OR "expectation_source" IN ('profile','family','level','family_level')
    );

CREATE INDEX IF NOT EXISTS "performance_review_items_expectation_rule_idx"
  ON "performance_review_items" ("organization_id","expectation_rule_id");

CREATE TABLE IF NOT EXISTS "performance_one_on_one_agenda_contributions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "one_on_one_id" integer NOT NULL REFERENCES "performance_one_on_ones"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "author_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "author_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "author_name" varchar(120) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "performance_one_on_one_agenda_contributions_meeting_idx"
  ON "performance_one_on_one_agenda_contributions" ("organization_id","one_on_one_id","created_at");

CREATE INDEX IF NOT EXISTS "performance_one_on_one_agenda_contributions_employee_idx"
  ON "performance_one_on_one_agenda_contributions" ("organization_id","employee_id","created_at");
