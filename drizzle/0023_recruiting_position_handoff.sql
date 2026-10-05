ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "target_start_date" date;

CREATE INDEX IF NOT EXISTS "job_requisitions_position_idx"
  ON "job_requisitions" ("organization_id","position_id");
CREATE INDEX IF NOT EXISTS "job_requisitions_org_unit_idx"
  ON "job_requisitions" ("organization_id","org_unit_id");

ALTER TABLE "job_applicants"
  ADD COLUMN IF NOT EXISTS "hired_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_at" timestamp with time zone;
