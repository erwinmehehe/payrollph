-- Issue #1031 P0-4 / HR cases schema-only group (2 of 24).
-- REVIEW-ONLY CANDIDATE; NOT a numbered migration or applied receipt.
-- NO-GO: NEVER execute on Neon, production, or any real employer database.
-- Only disposable isolated localhost PostgreSQL 16/18 in gated CI.
-- Current src/db/schema.ts (TypeScript AST/Drizzle metadata) is authoritative.
BEGIN;
DO $issue1031_hr_guard$
BEGIN
  IF to_regclass('public.organizations') IS NULL
    OR to_regclass('public.users') IS NULL
    OR to_regclass('public.employees') IS NULL
    OR to_regclass('public.documents') IS NULL THEN
    RAISE EXCEPTION 'ISSUE1031_HR_BASE_DEPENDENCY_MISSING' USING ERRCODE = 'P0001';
  END IF;
  -- Composite tenant FKs must not be silently weakened into id-only joins.
  -- Source-declared parent unique constraints are required. Drift is BLOCKING.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('public.employees') AND contype = 'u'
      AND conname = 'employees_org_id_workflows_unique'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('public.documents') AND contype = 'u'
      AND conname = 'documents_org_employee_id_hr_cases_unique'
  ) THEN
    RAISE EXCEPTION 'ISSUE1031_HR_PARENT_TENANT_KEY_MISSING_OR_DRIFTED' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.employee_hr_cases') IS NOT NULL
    OR to_regclass('public.employee_hr_case_messages') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1031_HR_TARGET_ALREADY_PRESENT' USING ERRCODE = 'P0001';
  END IF;
END $issue1031_hr_guard$;

CREATE TABLE "employee_hr_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "employee_hr_cases_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL CONSTRAINT "employee_hr_cases_employee_id_employees_id_fk"
    REFERENCES "employees"("id") ON DELETE cascade,
  "created_by_user_id" integer NOT NULL CONSTRAINT "employee_hr_cases_created_by_user_id_users_id_fk"
    REFERENCES "users"("id"),
  "case_type" varchar(32) NOT NULL,
  "subject" varchar(160) NOT NULL,
  "description" text NOT NULL,
  "assigned_role" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "sla_due_at" timestamptz NOT NULL,
  "coe_document_id" integer CONSTRAINT "employee_hr_cases_coe_document_id_documents_id_fk"
    REFERENCES "documents"("id"),
  "coe_approved_by_user_id" integer CONSTRAINT "employee_hr_cases_coe_approved_by_user_id_users_id_fk"
    REFERENCES "users"("id"),
  "coe_approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "employee_hr_cases_org_id_unique" UNIQUE ("organization_id", "id"),
  CONSTRAINT "employee_hr_cases_employee_tenant_fk"
    FOREIGN KEY ("organization_id", "employee_id")
    REFERENCES "employees"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "employee_hr_cases_coe_document_tenant_fk"
    FOREIGN KEY ("organization_id", "employee_id", "coe_document_id")
    REFERENCES "documents"("organization_id", "employee_id", "id"),
  CONSTRAINT "employee_hr_cases_status_check"
    CHECK ("status" in ('open','in_progress','waiting_employee','resolved','closed'))
);
CREATE INDEX "employee_hr_cases_employee_idx"
  ON "employee_hr_cases" ("organization_id", "employee_id", "created_at");
CREATE INDEX "employee_hr_cases_sla_idx"
  ON "employee_hr_cases" ("organization_id", "status", "sla_due_at");

CREATE TABLE "employee_hr_case_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "employee_hr_case_messages_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "case_id" integer NOT NULL CONSTRAINT "employee_hr_case_messages_case_id_employee_hr_cases_id_fk"
    REFERENCES "employee_hr_cases"("id") ON DELETE cascade,
  "actor_user_id" integer NOT NULL CONSTRAINT "employee_hr_case_messages_actor_user_id_users_id_fk"
    REFERENCES "users"("id"),
  "visibility" varchar(16) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "employee_hr_case_messages_case_tenant_fk"
    FOREIGN KEY ("organization_id", "case_id")
    REFERENCES "employee_hr_cases"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "employee_hr_case_messages_visibility_check"
    CHECK ("visibility" in ('employee','internal'))
);
CREATE INDEX "employee_hr_case_messages_case_idx"
  ON "employee_hr_case_messages" ("organization_id", "case_id", "created_at");
COMMIT;
