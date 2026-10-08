-- Dynamic Group guards for existing, deny-only permission assignments.
-- Worker identity is tenant-scoped; it is not a role assignment.
ALTER TABLE "user_organizations"
  ADD COLUMN IF NOT EXISTS "worker_employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_org_worker_employee_unique"
  ON "user_organizations" ("organization_id", "worker_employee_id")
  WHERE "worker_employee_id" IS NOT NULL;

ALTER TABLE "user_permission_assignments"
  ADD COLUMN IF NOT EXISTS "dynamic_group_id" integer REFERENCES "dynamic_worker_groups"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "dynamic_group_version" integer;

CREATE INDEX IF NOT EXISTS "user_permission_assignments_group_idx"
  ON "user_permission_assignments" ("organization_id", "dynamic_group_id");

DO $guard$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_assignments_group_pair_check'
  ) THEN
    ALTER TABLE "user_permission_assignments"
      ADD CONSTRAINT "user_permission_assignments_group_pair_check"
      CHECK (
        ("dynamic_group_id" IS NULL AND "dynamic_group_version" IS NULL) OR
        ("dynamic_group_id" IS NOT NULL AND "dynamic_group_version" >= 1)
      );
  END IF;
END $guard$;
