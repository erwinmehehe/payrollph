-- Enterprise multi-legal-entity employer structure
CREATE TABLE IF NOT EXISTS "legal_entities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "legal_name" varchar(200) NOT NULL,
  "display_name" varchar(160) NOT NULL,
  "bir_tin" varchar(16),
  "bir_branch_code" varchar(4),
  "sss_employer_no" varchar(24),
  "philhealth_employer_no" varchar(24),
  "pagibig_employer_no" varchar(24),
  "statutory_deduction_timing" varchar(24) DEFAULT 'split' NOT NULL,
  "payroll_calendar_mode" varchar(24) DEFAULT 'flexible' NOT NULL,
  "disbursement_bank_code" varchar(16),
  "disbursement_account_name" varchar(160),
  "disbursement_account" varchar(160),
  "primary_entity" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "legal_entities_statutory_timing_check"
    CHECK ("statutory_deduction_timing" IN ('split', 'first_cutoff', 'second_cutoff')),
  CONSTRAINT "legal_entities_calendar_mode_check"
    CHECK ("payroll_calendar_mode" IN ('flexible', 'ph_semi_monthly'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "legal_entities_org_code_unique"
  ON "legal_entities" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "legal_entities_org_primary_unique"
  ON "legal_entities" ("organization_id")
  WHERE "primary_entity" = true;
CREATE INDEX IF NOT EXISTS "legal_entities_org_active_idx"
  ON "legal_entities" ("organization_id", "active");

INSERT INTO "legal_entities" (
  "organization_id",
  "code",
  "legal_name",
  "display_name",
  "bir_tin",
  "bir_branch_code",
  "sss_employer_no",
  "philhealth_employer_no",
  "pagibig_employer_no",
  "statutory_deduction_timing",
  "payroll_calendar_mode",
  "primary_entity",
  "active"
)
SELECT
  o."id",
  'PRIMARY',
  o."legal_name",
  o."name",
  o."bir_tin",
  o."bir_branch_code",
  o."sss_employer_no",
  o."philhealth_employer_no",
  o."pagibig_employer_no",
  o."statutory_deduction_timing",
  o."payroll_calendar_mode",
  true,
  true
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_entities" le WHERE le."organization_id" = o."id"
);

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

UPDATE "employees" e
SET "legal_entity_id" = (
  SELECT le."id"
  FROM "legal_entities" le
  WHERE le."organization_id" = e."organization_id"
  ORDER BY le."primary_entity" DESC, le."id"
  LIMIT 1
)
WHERE e."legal_entity_id" IS NULL;

UPDATE "payroll_runs" pr
SET "legal_entity_id" = (
  SELECT le."id"
  FROM "legal_entities" le
  WHERE le."organization_id" = pr."organization_id"
  ORDER BY le."primary_entity" DESC, le."id"
  LIMIT 1
)
WHERE pr."legal_entity_id" IS NULL;

CREATE INDEX IF NOT EXISTS "employees_legal_entity_idx"
  ON "employees" ("organization_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "payroll_runs_legal_entity_idx"
  ON "payroll_runs" ("organization_id", "legal_entity_id");
