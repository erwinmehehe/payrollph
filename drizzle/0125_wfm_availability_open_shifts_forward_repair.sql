-- Issue #1054: forward-only WFM availability/open shifts schema candidate.
-- NOT a production apply authorization. Do not replay 0039 or use db:push.
-- Reviewed migration runner owns transaction and authentic checksum/receipt.
-- Fail closed on missing prerequisites or partially installed relations.
DO $issue1054_preflight$
DECLARE missing_objects text;
BEGIN
  SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO missing_objects
  FROM (VALUES
    ('public.organizations'), ('public.employees'), ('public.users'),
    ('public.worksites'), ('public.shift_definitions'),
    ('public.job_profiles'), ('public.staffing_requirements')
  ) AS required(object_name)
  WHERE to_regclass(object_name) IS NULL;

  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_MISSING_PREREQUISITES: %', missing_objects
      USING ERRCODE = 'P0001';
  END IF;

  -- An index name alone is not evidence of role-scoped uniqueness. Refuse
  -- a swapped/wrong-key index even when it uses the expected historical name.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    WHERE idx.oid = to_regclass('public.staffing_requirement_role_unique')
      AND i.indrelid = to_regclass('public.staffing_requirements')
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND pg_catalog.pg_get_indexdef(i.indexrelid) ILIKE
        '%(organization_id, worksite_id, work_date, shift_definition_id, COALESCE(job_profile_id, 0))%'
  ) THEN
    RAISE EXCEPTION 'ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.staffing_requirement_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_LEGACY_STAFFING_UNIQUENESS_PRESENT'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.employee_availability_rules') IS NOT NULL
     OR to_regclass('public.open_shifts') IS NOT NULL
     OR to_regclass('public.open_shift_claims') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION'
      USING ERRCODE = 'P0001';
  END IF;
END $issue1054_preflight$;

CREATE TABLE "employee_availability_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "weekday" integer NOT NULL,
  "start_time" varchar(8) NOT NULL,
  "end_time" varchar(8) NOT NULL,
  "availability_type" varchar(24) DEFAULT 'unavailable' NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "notes" varchar(240),
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "employee_availability_employee_idx"
  ON "employee_availability_rules" ("organization_id", "employee_id", "weekday");
CREATE INDEX "employee_availability_effective_idx"
  ON "employee_availability_rules" ("organization_id", "effective_from");

CREATE TABLE "open_shifts" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE restrict,
  "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict,
  "slots" integer DEFAULT 1 NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "source_requirement_id" integer REFERENCES "staffing_requirements"("id") ON DELETE set null,
  "reason" varchar(240) DEFAULT 'Coverage gap' NOT NULL,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "open_shifts_org_date_idx"
  ON "open_shifts" ("organization_id", "work_date", "status");
CREATE INDEX "open_shifts_worksite_idx"
  ON "open_shifts" ("organization_id", "worksite_id", "work_date");
CREATE INDEX "open_shifts_role_idx"
  ON "open_shifts" ("organization_id", "job_profile_id", "work_date", "status");

CREATE TABLE "open_shift_claims" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "open_shift_id" integer NOT NULL REFERENCES "open_shifts"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "reason" varchar(240) DEFAULT 'Open shift claim' NOT NULL,
  "requested_by" varchar(120) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "open_shift_claim_unique"
  ON "open_shift_claims" ("open_shift_id", "employee_id");
CREATE INDEX "open_shift_claim_org_status_idx"
  ON "open_shift_claims" ("organization_id", "status");
CREATE INDEX "open_shift_claim_employee_idx"
  ON "open_shift_claims" ("organization_id", "employee_id", "status");
