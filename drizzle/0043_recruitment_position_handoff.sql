-- Recruitment -> approved position -> employee lifecycle handoff.
-- 0024 is reserved by the open compensation-governance tranche.

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "job_requisitions"
    WHERE "position_id" IS NOT NULL
      AND "status" NOT IN ('filled', 'cancelled')
    GROUP BY "position_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active requisition per position: duplicate active requisitions exist. Resolve them before applying 0025.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "job_requisitions_active_position_unique"
  ON "job_requisitions" ("position_id")
  WHERE "position_id" IS NOT NULL
    AND "status" NOT IN ('filled', 'cancelled');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "position_assignments"
    WHERE "effective_until" IS NULL
    GROUP BY "position_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active incumbent per position: duplicate active position assignments exist. Resolve them before applying 0025.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_position_unique"
  ON "position_assignments" ("position_id")
  WHERE "effective_until" IS NULL;
