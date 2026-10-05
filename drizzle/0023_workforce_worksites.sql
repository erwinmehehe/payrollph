CREATE TABLE IF NOT EXISTS "worksites" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "code" varchar(32) NOT NULL,
  "name" varchar(160) NOT NULL,
  "site_type" varchar(32) DEFAULT 'office' NOT NULL,
  "timezone" varchar(64) DEFAULT 'Asia/Manila' NOT NULL,
  "region" varchar(64),
  "province" varchar(100),
  "city_municipality" varchar(120),
  "address_line_1" varchar(200),
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "worksites_org_code_unique"
  ON "worksites" ("organization_id", "code");
CREATE INDEX IF NOT EXISTS "worksites_org_active_idx"
  ON "worksites" ("organization_id", "active");
CREATE INDEX IF NOT EXISTS "worksites_org_unit_idx"
  ON "worksites" ("organization_id", "org_unit_id");

CREATE TABLE IF NOT EXISTS "employee_worksite_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE restrict,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) DEFAULT 'Worksite assignment' NOT NULL,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "employee_worksite_assignments_employee_date_idx"
  ON "employee_worksite_assignments" ("employee_id", "effective_from");
CREATE INDEX IF NOT EXISTS "employee_worksite_assignments_org_worksite_idx"
  ON "employee_worksite_assignments" ("organization_id", "worksite_id");

ALTER TABLE "employee_schedule_assignments"
  ADD COLUMN IF NOT EXISTS "worksite_id" integer REFERENCES "worksites"("id") ON DELETE set null;

ALTER TABLE "schedule_overrides"
  ADD COLUMN IF NOT EXISTS "worksite_id" integer REFERENCES "worksites"("id") ON DELETE set null;

ALTER TABLE "holidays"
  ADD COLUMN IF NOT EXISTS "worksite_id" integer REFERENCES "worksites"("id") ON DELETE cascade;
