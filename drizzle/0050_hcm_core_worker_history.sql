ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

CREATE INDEX IF NOT EXISTS "positions_legal_entity_idx"
  ON "positions" ("organization_id", "legal_entity_id");

ALTER TABLE "position_assignments"
  ADD COLUMN IF NOT EXISTS "assignment_type" varchar(24) NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS "fte" numeric(5,4) NOT NULL DEFAULT '1.0000';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "position_assignments"
    WHERE "effective_until" IS NULL
      AND "assignment_type" = 'primary'
    GROUP BY "organization_id", "employee_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HCM Core 2.0 requires at most one active primary position assignment per employee. Resolve duplicate active assignments before applying this migration.';
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_primary_employee_unique"
  ON "position_assignments" ("organization_id", "employee_id")
  WHERE "assignment_type" = 'primary' AND "effective_until" IS NULL;

CREATE INDEX IF NOT EXISTS "position_assignments_employee_date_idx"
  ON "position_assignments" ("employee_id", "effective_from");

CREATE TABLE IF NOT EXISTS "worker_employment_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_date" date NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "position_assignment_id" integer REFERENCES "position_assignments"("id") ON DELETE set null,
  "from_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "to_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "from_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "to_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "from_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "to_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "from_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "to_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "from_employment_type" varchar(32),
  "to_employment_type" varchar(32),
  "from_status" varchar(32),
  "to_status" varchar(32),
  "reason" varchar(240) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "worker_employment_events_employee_date_idx"
  ON "worker_employment_events" ("organization_id", "employee_id", "effective_date");

CREATE INDEX IF NOT EXISTS "worker_employment_events_org_type_idx"
  ON "worker_employment_events" ("organization_id", "event_type");

UPDATE "positions" AS p
SET "legal_entity_id" = e."legal_entity_id"
FROM "position_assignments" AS pa
JOIN "employees" AS e
  ON e."id" = pa."employee_id"
 AND e."organization_id" = pa."organization_id"
WHERE pa."position_id" = p."id"
  AND pa."effective_until" IS NULL
  AND pa."assignment_type" = 'primary'
  AND p."legal_entity_id" IS NULL
  AND e."legal_entity_id" IS NOT NULL;
