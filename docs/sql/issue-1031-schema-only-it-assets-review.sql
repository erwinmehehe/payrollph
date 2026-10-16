-- Issue #1031 P0-4 / 24 schema-only gaps, IT-assets group (4/24).
-- REVIEW-ONLY CANDIDATE. NOT A NUMBERED MIGRATION OR EXECUTION RECEIPT.
-- NO-GO: never execute on Neon, production, or any real employer database.
-- Only disposable localhost PostgreSQL 16/18 in an explicitly gated CI rehearsal.
-- Current src/db/schema.ts is the final-shape authority; no historical
-- source file, applied migration, runtime writer, payroll or user data changed.
BEGIN;
DO $issue1031_it_guard$
BEGIN
  IF to_regclass('public.organizations') IS NULL
    OR to_regclass('public.users') IS NULL
    OR to_regclass('public.employees') IS NULL
    OR to_regclass('public.assets') IS NULL THEN
    RAISE EXCEPTION 'ISSUE1031_IT_BASE_DEPENDENCY_MISSING' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.it_applications') IS NOT NULL
    OR to_regclass('public.it_managed_devices') IS NOT NULL
    OR to_regclass('public.it_access_grants') IS NOT NULL
    OR to_regclass('public.it_device_events') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1031_IT_TARGET_ALREADY_PRESENT' USING ERRCODE = 'P0001';
  END IF;
END $issue1031_it_guard$;

CREATE TABLE "it_applications" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "it_applications_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "it_applications_org_name_unique"
  ON "it_applications" ("organization_id", "name");

CREATE TABLE "it_managed_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "it_managed_devices_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "asset_id" integer NOT NULL CONSTRAINT "it_managed_devices_asset_id_assets_id_fk"
    REFERENCES "assets"("id") ON DELETE restrict,
  "employee_id" integer CONSTRAINT "it_managed_devices_employee_id_employees_id_fk"
    REFERENCES "employees"("id") ON DELETE set null,
  "state" varchar(24) DEFAULT 'available' NOT NULL,
  "mdm_provider" varchar(100),
  "mdm_reference" varchar(160),
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "it_managed_devices_state_check"
    CHECK ("state" in ('available','assigned','return_requested','returned','lost','retired'))
);
CREATE UNIQUE INDEX "it_managed_devices_asset_unique"
  ON "it_managed_devices" ("asset_id");
CREATE INDEX "it_managed_devices_org_idx"
  ON "it_managed_devices" ("organization_id", "state");

CREATE TABLE "it_access_grants" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "it_access_grants_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL CONSTRAINT "it_access_grants_employee_id_employees_id_fk"
    REFERENCES "employees"("id") ON DELETE restrict,
  "application_id" integer NOT NULL CONSTRAINT "it_access_grants_application_id_it_applications_id_fk"
    REFERENCES "it_applications"("id") ON DELETE restrict,
  "state" varchar(24) DEFAULT 'grant_requested' NOT NULL,
  "requested_by_user_id" integer CONSTRAINT "it_access_grants_requested_by_user_id_users_id_fk"
    REFERENCES "users"("id") ON DELETE set null,
  "confirmed_by_user_id" integer CONSTRAINT "it_access_grants_confirmed_by_user_id_users_id_fk"
    REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "it_access_grants_state_check"
    CHECK ("state" in ('grant_requested','active','revoke_requested','revoked'))
);
CREATE UNIQUE INDEX "it_access_grants_unique"
  ON "it_access_grants" ("organization_id", "employee_id", "application_id");
CREATE INDEX "it_access_grants_queue_idx"
  ON "it_access_grants" ("organization_id", "state");

CREATE TABLE "it_device_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL CONSTRAINT "it_device_events_organization_id_organizations_id_fk"
    REFERENCES "organizations"("id") ON DELETE cascade,
  "device_id" integer NOT NULL CONSTRAINT "it_device_events_device_id_it_managed_devices_id_fk"
    REFERENCES "it_managed_devices"("id") ON DELETE restrict,
  "event_type" varchar(48) NOT NULL,
  "employee_id" integer CONSTRAINT "it_device_events_employee_id_employees_id_fk"
    REFERENCES "employees"("id") ON DELETE set null,
  "actor_user_id" integer CONSTRAINT "it_device_events_actor_user_id_users_id_fk"
    REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "it_device_events_idx"
  ON "it_device_events" ("organization_id", "device_id", "created_at");
COMMIT;
