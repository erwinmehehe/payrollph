-- Issue #1046: fictional-development Neon default ADD-ONLY forward schema repair.
-- Public Vercel deployment calls itself production but connected Neon data were
-- explicitly classified as fictional development in PR #1039.
-- Source-derived from drizzle/0042_compensation_governance.sql and
-- drizzle/0054_hcm_compensation_architecture.sql; DO NOT create historical
-- migration receipts or reuse this file for a real-employer release.
-- Six missing tables only, no seeds, no data updates, no destructive operations.
-- Branch rehearsal and strict full-column/source checks required before apply.

DO $guard$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.job_profiles') IS NULL
     OR to_regclass('public.job_grades') IS NULL
     OR to_regclass('public.legal_entities') IS NULL
     OR to_regclass('public.worker_effective_changes') IS NULL
     OR to_regclass('public.employee_pay_revisions') IS NULL
  THEN RAISE EXCEPTION 'ISSUE_1046_BASE_RELATION_MISSING'; END IF;
  IF to_regclass('public.compensation_bands') IS NOT NULL
     OR to_regclass('public.compensation_cycles') IS NOT NULL
     OR to_regclass('public.compensation_proposals') IS NOT NULL
     OR to_regclass('public.compensation_components') IS NOT NULL
     OR to_regclass('public.employee_compensation_components') IS NOT NULL
     OR to_regclass('public.compensation_events') IS NOT NULL
  THEN RAISE EXCEPTION 'ISSUE_1046_TARGET_ALREADY_EXISTS_REQUIRES_REVIEW'; END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS "compensation_bands" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict,
  "grade_id" integer REFERENCES "job_grades"("id") ON DELETE restrict,
  "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "location_code" varchar(80) DEFAULT 'PH' NOT NULL,
  "currency" varchar(8) DEFAULT 'PHP' NOT NULL,
  "minimum_annual" numeric(14,2) NOT NULL,
  "midpoint_annual" numeric(14,2) NOT NULL,
  "maximum_annual" numeric(14,2) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "compensation_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "effective_date" date NOT NULL,
  "budget_pool" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "compensation_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "compensation_cycles"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "band_id" integer NOT NULL REFERENCES "compensation_bands"("id") ON DELETE restrict,
  "current_annual" numeric(14,2) NOT NULL,
  "proposed_annual" numeric(14,2) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "status" varchar(24) DEFAULT 'proposed' NOT NULL,
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamptz,
  "scheduled_at" timestamptz,
  "applied_at" timestamptz,
  "failure" text,
  "worker_effective_change_id" integer REFERENCES "worker_effective_changes"("id") ON DELETE set null,
  "applied_pay_revision_id" integer REFERENCES "employee_pay_revisions"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

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

CREATE INDEX IF NOT EXISTS "compensation_bands_org_active_idx"
  ON "compensation_bands" ("organization_id","active");

CREATE UNIQUE INDEX IF NOT EXISTS "compensation_cycles_org_name_dates_unique"
  ON "compensation_cycles" ("organization_id","name","start_date","end_date");

CREATE INDEX IF NOT EXISTS "compensation_cycles_org_status_idx"
  ON "compensation_cycles" ("organization_id","status");

CREATE UNIQUE INDEX IF NOT EXISTS "compensation_proposals_cycle_employee_unique"
  ON "compensation_proposals" ("cycle_id","employee_id");

CREATE INDEX IF NOT EXISTS "compensation_proposals_org_status_idx"
  ON "compensation_proposals" ("organization_id","status");

CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_scope_effective_unique"
  ON "compensation_bands" ("organization_id","job_profile_id","grade_id","legal_entity_id","location_code","effective_from");

CREATE INDEX IF NOT EXISTS "compensation_bands_org_grade_idx"
  ON "compensation_bands" ("organization_id","grade_id");

CREATE INDEX IF NOT EXISTS "compensation_bands_org_legal_entity_idx"
  ON "compensation_bands" ("organization_id","legal_entity_id");

CREATE INDEX IF NOT EXISTS "compensation_bands_org_effective_idx"
  ON "compensation_bands" ("organization_id","effective_from","effective_until");

CREATE UNIQUE INDEX IF NOT EXISTS "compensation_components_org_code_unique"
  ON "compensation_components" ("organization_id","code");

CREATE UNIQUE INDEX IF NOT EXISTS "compensation_components_org_name_unique"
  ON "compensation_components" ("organization_id","name");

CREATE INDEX IF NOT EXISTS "compensation_components_org_active_idx"
  ON "compensation_components" ("organization_id","active");

CREATE INDEX IF NOT EXISTS "employee_comp_components_active_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","component_id","status");

CREATE INDEX IF NOT EXISTS "employee_comp_components_employee_date_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","effective_from");

CREATE INDEX IF NOT EXISTS "employee_comp_components_status_date_idx"
  ON "employee_compensation_components" ("organization_id","status","effective_from");

CREATE INDEX IF NOT EXISTS "compensation_events_employee_date_idx"
  ON "compensation_events" ("organization_id","employee_id","effective_date");

CREATE INDEX IF NOT EXISTS "compensation_events_org_type_idx"
  ON "compensation_events" ("organization_id","event_type");
