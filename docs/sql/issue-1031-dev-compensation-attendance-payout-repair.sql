-- Development only / Issue #1031 stage 3: restore the compensation-governance,
-- attendance-exception and payout-dual-control tables still absent after
-- stages 1-2 (docs/sql/issue-1031-dev-workforce-bi-repair.sql,
-- docs/sql/issue-1031-dev-workforce-followups.sql, already applied in the
-- fictional dev environment). This file is NOT a numbered production
-- migration and must never be used to forge historical receipts.
--
-- Final shape reconciled from 0042 (compensation_governance), 0054
-- (hcm_compensation_architecture), 0067 (attendance_exception_events), 0088
-- (attendance_exception_governance), 0073 (payout_destination_dual_control)
-- and current src/db/schema.ts. Where 0042/0054 or 0067/0088 added columns
-- or replaced an index after the original CREATE, this file defines the
-- table directly in its final current-schema shape rather than replaying
-- the historical ALTER sequence, matching the discipline of stage 1/2.
--
-- Additive DDL only; no user, worker, payroll, approval or payout records
-- are seeded. compensation_events is deliberately NOT included here: it is
-- not in the verified "still absent" list in
-- docs/engineering/issue-1031-schema-drift-remediation.md and must not be
-- recreated if it already exists.

DO $guard$ BEGIN
 IF to_regclass('public.organizations') IS NULL
 OR to_regclass('public.users') IS NULL
 OR to_regclass('public.employees') IS NULL
 OR to_regclass('public.time_punches') IS NULL
 OR to_regclass('public.job_profiles') IS NULL
 OR to_regclass('public.job_grades') IS NULL
 OR to_regclass('public.legal_entities') IS NULL
 OR to_regclass('public.employee_pay_revisions') IS NULL
 OR to_regclass('public.worker_effective_changes') IS NULL THEN
   RAISE EXCEPTION 'ISSUE_1031_STAGE3_BASE_DEPENDENCY_MISSING';
 END IF;
 IF to_regclass('public.compensation_bands') IS NOT NULL
 OR to_regclass('public.compensation_cycles') IS NOT NULL
 OR to_regclass('public.compensation_proposals') IS NOT NULL
 OR to_regclass('public.compensation_components') IS NOT NULL
 OR to_regclass('public.employee_compensation_components') IS NOT NULL
 OR to_regclass('public.attendance_exception_events') IS NOT NULL
 OR to_regclass('public.employee_payout_change_requests') IS NOT NULL THEN
   RAISE EXCEPTION 'ISSUE_1031_STAGE3_ALREADY_OR_PARTIALLY_REPAIRED';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS "compensation_bands" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict,
  "grade_id" integer REFERENCES "job_grades"("id") ON DELETE restrict,
  "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  "location_code" varchar(80) DEFAULT 'PH' NOT NULL,
  "currency" varchar(8) DEFAULT 'PHP' NOT NULL,
  "minimum_annual" numeric(14,2) NOT NULL,
  "midpoint_annual" numeric(14,2) NOT NULL,
  "maximum_annual" numeric(14,2) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_scope_effective_unique"
  ON "compensation_bands" ("organization_id","job_profile_id","grade_id","legal_entity_id","location_code","effective_from");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_grade_idx"
  ON "compensation_bands" ("organization_id","grade_id");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_legal_entity_idx"
  ON "compensation_bands" ("organization_id","legal_entity_id");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_effective_idx"
  ON "compensation_bands" ("organization_id","effective_from","effective_until");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_active_idx"
  ON "compensation_bands" ("organization_id","active");

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
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_cycles_org_name_dates_unique"
  ON "compensation_cycles" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "compensation_cycles_org_status_idx"
  ON "compensation_cycles" ("organization_id","status");

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
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_proposals_cycle_employee_unique"
  ON "compensation_proposals" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "compensation_proposals_org_status_idx"
  ON "compensation_proposals" ("organization_id","status");

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
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
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
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "employee_comp_components_active_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","component_id","status");
CREATE INDEX IF NOT EXISTS "employee_comp_components_employee_date_idx"
  ON "employee_compensation_components" ("organization_id","employee_id","effective_from");
CREATE INDEX IF NOT EXISTS "employee_comp_components_status_date_idx"
  ON "employee_compensation_components" ("organization_id","status","effective_from");

CREATE TABLE IF NOT EXISTS "attendance_exception_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "exception_kind" varchar(40) NOT NULL,
  "severity" varchar(16) NOT NULL
    CHECK ("severity" IN ('info','warning','blocker')),
  "punch_id" integer REFERENCES "time_punches"("id") ON DELETE set null,
  "minutes" integer,
  "message" text NOT NULL,
  "fingerprint_sha256" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open','resolved')),
  "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "owner_name" varchar(120),
  "sla_due_at" timestamptz,
  "first_detected_at" timestamptz NOT NULL DEFAULT now(),
  "last_detected_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "resolution_note" text,
  "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "resolved_by_name" varchar(120),
  "resolution_recorded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_exception_events_fingerprint_unique"
  ON "attendance_exception_events" ("organization_id","employee_id","work_date","fingerprint_sha256");
CREATE INDEX IF NOT EXISTS "attendance_exception_events_open_idx"
  ON "attendance_exception_events" ("organization_id","status","work_date","employee_id");
CREATE INDEX IF NOT EXISTS "attendance_exception_events_employee_idx"
  ON "attendance_exception_events" ("organization_id","employee_id","work_date");
CREATE INDEX IF NOT EXISTS "attendance_exception_events_owner_idx"
  ON "attendance_exception_events" ("organization_id","status","owner_user_id","sla_due_at");
CREATE INDEX IF NOT EXISTS "attendance_exception_events_sla_idx"
  ON "attendance_exception_events" ("organization_id","status","sla_due_at");

CREATE TABLE IF NOT EXISTS "employee_payout_change_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "status" varchar(24) NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','approved','rejected','cancelled')),
  "reason" varchar(360) NOT NULL,
  "original_snapshot" jsonb NOT NULL,
  "original_state_sha256" varchar(64) NOT NULL,
  "proposed_bank_account" varchar(160),
  "proposed_bank_code" varchar(16),
  "proposed_mobile" varchar(24),
  "proposed_masked_account" varchar(64),
  "requested_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "requested_by_name" varchar(120) NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by_name" varchar(120),
  "decision_note" varchar(500),
  "decided_at" timestamptz,
  "applied_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_payout_change_requests_open_employee_unique"
  ON "employee_payout_change_requests" ("organization_id","employee_id")
  WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "employee_payout_change_requests_org_status_idx"
  ON "employee_payout_change_requests" ("organization_id","status","created_at");
CREATE INDEX IF NOT EXISTS "employee_payout_change_requests_employee_idx"
  ON "employee_payout_change_requests" ("organization_id","employee_id","created_at");
