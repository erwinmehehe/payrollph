-- HCM Core 2.3: grade-aware salary architecture, recurring compensation components,
-- effective-dated proposal application, and immutable compensation history.

ALTER TABLE "compensation_bands"
  ALTER COLUMN "job_profile_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "grade_id" integer REFERENCES "job_grades"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "effective_from" date,
  ADD COLUMN IF NOT EXISTS "effective_until" date;

UPDATE "compensation_bands" b
SET "grade_id" = jp."grade_id"
FROM "job_profiles" jp
WHERE b."job_profile_id" = jp."id"
  AND b."grade_id" IS NULL;

UPDATE "compensation_bands"
SET "effective_from" = DATE '1900-01-01'
WHERE "effective_from" IS NULL;

ALTER TABLE "compensation_bands"
  ALTER COLUMN "effective_from" SET NOT NULL;

DROP INDEX IF EXISTS "compensation_bands_org_profile_location_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_scope_effective_unique"
  ON "compensation_bands" ("organization_id","job_profile_id","grade_id","legal_entity_id","location_code","effective_from");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_grade_idx"
  ON "compensation_bands" ("organization_id","grade_id");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_legal_entity_idx"
  ON "compensation_bands" ("organization_id","legal_entity_id");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_effective_idx"
  ON "compensation_bands" ("organization_id","effective_from","effective_until");

ALTER TABLE "compensation_proposals"
  ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "failure" text,
  ADD COLUMN IF NOT EXISTS "worker_effective_change_id" integer REFERENCES "worker_effective_changes"("id") ON DELETE set null;

CREATE TABLE IF NOT EXISTS "compensation_components" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(120) NOT NULL,
  "kind" varchar(32) DEFAULT 'allowance' NOT NULL,
  "amount_frequency" varchar(24) DEFAULT 'monthly' NOT NULL,
  "taxable" boolean DEFAULT true NOT NULL,
  "include_in_sss_base" boolean DEFAULT true NOT NULL,
  "include_in_pagibig_base" boolean DEFAULT true NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_components_org_code_unique"
  ON "compensation_components" ("organization_id","code");
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_components_org_name_unique"
  ON "compensation_components" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "compensation_components_org_active_idx"
  ON "compensation_components" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "employee_compensation_components" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "component_id" integer NOT NULL REFERENCES "compensation_components"("id") ON DELETE restrict,
  "amount" numeric(12,2) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "status" varchar(24) DEFAULT 'pending_approval' NOT NULL,
  "reason" varchar(240) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "employee_comp_components_active_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","component_id","status");
CREATE INDEX IF NOT EXISTS "employee_comp_components_employee_date_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","effective_from");
CREATE INDEX IF NOT EXISTS "employee_comp_components_status_date_idx"
  ON "employee_compensation_components" ("organization_id","status","effective_from");

CREATE TABLE IF NOT EXISTS "compensation_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(40) NOT NULL,
  "effective_date" date NOT NULL,
  "previous_annual" numeric(14,2),
  "new_annual" numeric(14,2),
  "band_id" integer REFERENCES "compensation_bands"("id") ON DELETE set null,
  "proposal_id" integer REFERENCES "compensation_proposals"("id") ON DELETE set null,
  "component_assignment_id" integer REFERENCES "employee_compensation_components"("id") ON DELETE set null,
  "pay_revision_id" integer REFERENCES "employee_pay_revisions"("id") ON DELETE set null,
  "compa_ratio_before" numeric(8,4),
  "compa_ratio_after" numeric(8,4),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "compensation_events_employee_date_idx"
  ON "compensation_events" ("organization_id","employee_id","effective_date");
CREATE INDEX IF NOT EXISTS "compensation_events_org_type_idx"
  ON "compensation_events" ("organization_id","event_type");
