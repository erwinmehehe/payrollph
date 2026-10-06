-- Role/job-profile demand across WFM coverage, open shifts, and scenarios
ALTER TABLE "staffing_requirements"
  ADD COLUMN IF NOT EXISTS "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict;

DROP INDEX IF EXISTS "staffing_requirement_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_role_unique"
  ON "staffing_requirements" (
    "organization_id",
    "worksite_id",
    "work_date",
    "shift_definition_id",
    COALESCE("job_profile_id", 0)
  );
CREATE INDEX IF NOT EXISTS "staffing_requirement_role_idx"
  ON "staffing_requirements" ("organization_id", "job_profile_id", "work_date");

ALTER TABLE "open_shifts"
  ADD COLUMN IF NOT EXISTS "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict;

CREATE INDEX IF NOT EXISTS "open_shifts_role_idx"
  ON "open_shifts" ("organization_id", "job_profile_id", "work_date", "status");
