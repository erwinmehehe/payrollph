ALTER TABLE "job_applicants"
  ADD COLUMN IF NOT EXISTS "hired_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "hired_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "job_applicants_hired_employee_unique"
  ON "job_applicants" ("hired_employee_id")
  WHERE "hired_employee_id" IS NOT NULL;

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "requisition_id" integer REFERENCES "job_requisitions"("id") ON DELETE set null;

CREATE UNIQUE INDEX IF NOT EXISTS "positions_requisition_unique"
  ON "positions" ("requisition_id")
  WHERE "requisition_id" IS NOT NULL;
