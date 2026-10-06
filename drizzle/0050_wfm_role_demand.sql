ALTER TABLE "staffing_requirements"
  ADD COLUMN IF NOT EXISTS "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict;

DROP INDEX IF EXISTS "staffing_requirement_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_generic_unique"
  ON "staffing_requirements" ("organization_id", "worksite_id", "work_date", "shift_definition_id")
  WHERE "job_profile_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_profile_unique"
  ON "staffing_requirements" ("organization_id", "worksite_id", "work_date", "shift_definition_id", "job_profile_id")
  WHERE "job_profile_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "staffing_requirement_profile_date_idx"
  ON "staffing_requirements" ("organization_id", "job_profile_id", "work_date");
