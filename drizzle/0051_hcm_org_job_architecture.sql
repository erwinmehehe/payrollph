DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "org_units"
    GROUP BY "organization_id", "code"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HCM Core 2.1 requires organization-unit codes to be unique inside each organization. Resolve duplicate codes before applying this migration.';
  END IF;
END
$guard$;

ALTER TABLE "org_units"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "effective_from" date,
  ADD COLUMN IF NOT EXISTS "effective_until" date,
  ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "org_units_org_code_unique"
  ON "org_units" ("organization_id", "code");
CREATE INDEX IF NOT EXISTS "org_units_org_parent_idx"
  ON "org_units" ("organization_id", "parent_id");
CREATE INDEX IF NOT EXISTS "org_units_org_type_idx"
  ON "org_units" ("organization_id", "type", "active");
CREATE INDEX IF NOT EXISTS "org_units_legal_entity_idx"
  ON "org_units" ("organization_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "org_units_cost_center_idx"
  ON "org_units" ("organization_id", "cost_center_id");

CREATE TABLE IF NOT EXISTS "job_families" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_families_org_code_unique" ON "job_families" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_families_org_name_unique" ON "job_families" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_families_org_active_idx" ON "job_families" ("organization_id", "active");

CREATE TABLE IF NOT EXISTS "job_levels" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_levels_org_code_unique" ON "job_levels" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_levels_org_name_unique" ON "job_levels" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_levels_org_sequence_idx" ON "job_levels" ("organization_id", "sequence");

CREATE TABLE IF NOT EXISTS "job_grades" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_grades_org_code_unique" ON "job_grades" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_grades_org_name_unique" ON "job_grades" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_grades_org_sequence_idx" ON "job_grades" ("organization_id", "sequence");

INSERT INTO "job_families" ("organization_id", "code", "name")
SELECT DISTINCT jp."organization_id",
  'LEGACY-FAM-' || upper(substr(md5(jp."organization_id"::text || ':' || jp."family"), 1, 8)),
  jp."family"
FROM "job_profiles" jp
WHERE nullif(trim(jp."family"), '') IS NOT NULL
ON CONFLICT ("organization_id", "name") DO NOTHING;

INSERT INTO "job_levels" ("organization_id", "code", "name", "sequence")
SELECT DISTINCT jp."organization_id",
  'LEGACY-LVL-' || upper(substr(md5(jp."organization_id"::text || ':' || jp."level"), 1, 8)),
  jp."level",
  0
FROM "job_profiles" jp
WHERE nullif(trim(jp."level"), '') IS NOT NULL
ON CONFLICT ("organization_id", "name") DO NOTHING;

INSERT INTO "job_grades" ("organization_id", "code", "name", "sequence")
SELECT DISTINCT jp."organization_id",
  'LEGACY-GRD-' || upper(substr(md5(jp."organization_id"::text || ':' || jp."grade"), 1, 8)),
  jp."grade",
  0
FROM "job_profiles" jp
WHERE nullif(trim(jp."grade"), '') IS NOT NULL
ON CONFLICT ("organization_id", "name") DO NOTHING;

ALTER TABLE "job_profiles"
  ADD COLUMN IF NOT EXISTS "family_id" integer REFERENCES "job_families"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "level_id" integer REFERENCES "job_levels"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "grade_id" integer REFERENCES "job_grades"("id") ON DELETE restrict;

UPDATE "job_profiles" jp
SET "family_id" = jf."id"
FROM "job_families" jf
WHERE jf."organization_id" = jp."organization_id"
  AND jf."name" = jp."family"
  AND jp."family_id" IS NULL;

UPDATE "job_profiles" jp
SET "level_id" = jl."id"
FROM "job_levels" jl
WHERE jl."organization_id" = jp."organization_id"
  AND jl."name" = jp."level"
  AND jp."level_id" IS NULL;

UPDATE "job_profiles" jp
SET "grade_id" = jg."id"
FROM "job_grades" jg
WHERE jg."organization_id" = jp."organization_id"
  AND jg."name" = jp."grade"
  AND jp."grade_id" IS NULL;

CREATE INDEX IF NOT EXISTS "job_profiles_org_family_idx" ON "job_profiles" ("organization_id", "family_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_level_idx" ON "job_profiles" ("organization_id", "level_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_grade_idx" ON "job_profiles" ("organization_id", "grade_id");

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "positions_supervisory_org_idx"
  ON "positions" ("organization_id", "supervisory_org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_cost_center_idx"
  ON "positions" ("organization_id", "cost_center_id");
