ALTER TABLE "job_applicants"
  ADD COLUMN IF NOT EXISTS "hired_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "job_applicants_hired_employee_unique"
  ON "job_applicants" ("hired_employee_id")
  WHERE "hired_employee_id" IS NOT NULL;

ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "position_id" integer REFERENCES "positions"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "job_requisitions_position_idx"
  ON "job_requisitions" ("organization_id", "position_id");

CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_position_unique"
  ON "position_assignments" ("position_id")
  WHERE "effective_until" IS NULL;
