-- #1031: additive restoration of absent development-only HCM, permission, and BI tables.
-- Reconstructed from exact source definitions 0022/0040/0044/0051/0082/0095,
-- reconciled to src/db/schema.ts (2026-10-15). No worker, payroll, or role rows
-- are seeded or altered; unassigned permission sets preserve deny-only policy.
-- Initial deployment requires an isolated-branch rehearsal and operator review.
-- DO NOT mark historical migration receipts as applied by this repair.

DO $guard$ BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.user_organizations') IS NULL
     OR to_regclass('public.org_units') IS NULL
     OR to_regclass('public.legal_entities') IS NULL
     OR to_regclass('public.cost_centers') IS NULL
     OR to_regclass('public.workforce_plans') IS NULL
     OR to_regclass('public.job_requisitions') IS NULL
  THEN RAISE EXCEPTION 'ISSUE_1031_INCOMPATIBLE_BASE_SCHEMA'; END IF;
  IF to_regclass('public.user_permission_assignments') IS NOT NULL
     OR to_regclass('public.permission_sets') IS NOT NULL
     OR to_regclass('public.dynamic_worker_groups') IS NOT NULL
     OR to_regclass('public.job_profiles') IS NOT NULL
     OR to_regclass('public.positions') IS NOT NULL
     OR to_regclass('public.position_assignments') IS NOT NULL
     OR to_regclass('public.workforce_timesheets') IS NOT NULL
  THEN RAISE EXCEPTION 'ISSUE_1031_PARTIAL_OR_PREVIOUS_REPAIR_REQUIRES_REVIEW'; END IF;
END $guard$;

-- Dynamic Worker Groups / Supergroups: reusable live populations for Automation, WFM and enterprise controls.

CREATE TABLE IF NOT EXISTS "dynamic_worker_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" varchar(500),
  "conditions" jsonb NOT NULL DEFAULT '{"version":1,"all":[],"any":[]}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dynamic_worker_groups_org_code_unique"
  ON "dynamic_worker_groups" ("organization_id","code");

CREATE INDEX IF NOT EXISTS "dynamic_worker_groups_org_active_idx"
  ON "dynamic_worker_groups" ("organization_id","active","name");

CREATE TABLE IF NOT EXISTS "permission_sets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "description" text,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "permission_sets_org_name_unique" ON "permission_sets" ("organization_id","name");

CREATE TABLE IF NOT EXISTS "user_permission_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_organization_id" integer NOT NULL REFERENCES "user_organizations"("id") ON DELETE cascade,
  "permission_set_id" integer NOT NULL REFERENCES "permission_sets"("id") ON DELETE cascade,
  "assigned_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_assignments_membership_unique" ON "user_permission_assignments" ("user_organization_id");
CREATE INDEX IF NOT EXISTS "user_permission_assignments_org_idx" ON "user_permission_assignments" ("organization_id");

ALTER TABLE "user_permission_assignments"
  ADD COLUMN IF NOT EXISTS "dynamic_group_id" integer REFERENCES "dynamic_worker_groups"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "dynamic_group_version" integer;
CREATE INDEX IF NOT EXISTS "user_permission_assignments_group_idx"
  ON "user_permission_assignments" ("organization_id","dynamic_group_id");
ALTER TABLE "user_permission_assignments" ADD CONSTRAINT "user_permission_assignments_group_pair_check"
  CHECK (("dynamic_group_id" IS NULL AND "dynamic_group_version" IS NULL) OR
         ("dynamic_group_id" IS NOT NULL AND "dynamic_group_version" >= 1));

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

CREATE TABLE IF NOT EXISTS "job_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "title" varchar(160) NOT NULL,
  "family" varchar(120) DEFAULT 'General' NOT NULL,
  "level" varchar(80) DEFAULT 'Individual Contributor' NOT NULL,
  "grade" varchar(40),
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_profiles_org_title_level_unique" ON "job_profiles" ("organization_id","title","level");
CREATE INDEX IF NOT EXISTS "job_profiles_org_active_idx" ON "job_profiles" ("organization_id","active");

ALTER TABLE "job_profiles"
  ADD COLUMN IF NOT EXISTS "family_id" integer REFERENCES "job_families"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "level_id" integer REFERENCES "job_levels"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "grade_id" integer REFERENCES "job_grades"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "job_profiles_org_family_idx" ON "job_profiles" ("organization_id","family_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_level_idx" ON "job_profiles" ("organization_id","level_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_grade_idx" ON "job_profiles" ("organization_id","grade_id");

CREATE TABLE IF NOT EXISTS "positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(48) NOT NULL,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "employment_type" varchar(32) DEFAULT 'Regular' NOT NULL,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "planned_start_date" date,
  "annual_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "positions_org_code_unique" ON "positions" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "positions_org_status_idx" ON "positions" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "positions_org_unit_idx" ON "positions" ("organization_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_plan_idx" ON "positions" ("plan_id");

CREATE TABLE IF NOT EXISTS "position_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) DEFAULT 'Position assignment' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_position_from_unique" ON "position_assignments" ("position_id","effective_from");
CREATE INDEX IF NOT EXISTS "position_assignments_employee_idx" ON "position_assignments" ("organization_id","employee_id");

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "positions_supervisory_org_idx" ON "positions" ("organization_id","supervisory_org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_cost_center_idx" ON "positions" ("organization_id","cost_center_id");
CREATE INDEX IF NOT EXISTS "positions_legal_entity_idx" ON "positions" ("organization_id","legal_entity_id");
ALTER TABLE "position_assignments"
  ADD COLUMN IF NOT EXISTS "assignment_type" varchar(24) NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS "fte" numeric(5,4) NOT NULL DEFAULT '1.0000';
CREATE INDEX IF NOT EXISTS "position_assignments_employee_date_idx" ON "position_assignments" ("employee_id","effective_from");
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_position_unique" ON "position_assignments" ("position_id") WHERE "effective_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_primary_employee_unique"
  ON "position_assignments" ("organization_id","employee_id")
  WHERE "assignment_type" = 'primary' AND "effective_until" IS NULL;

ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "position_id" integer REFERENCES "positions"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "plan_handoff_evidence" jsonb,
  ADD COLUMN IF NOT EXISTS "role_skill_snapshot" jsonb;
CREATE INDEX IF NOT EXISTS "job_requisitions_position_idx" ON "job_requisitions" ("organization_id","position_id");
CREATE UNIQUE INDEX IF NOT EXISTS "job_requisitions_active_position_unique" ON "job_requisitions" ("position_id")
  WHERE "position_id" IS NOT NULL AND "status" NOT IN ('filled','cancelled');

CREATE TABLE IF NOT EXISTS "workforce_timesheet_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "enforcement_mode" varchar(24) DEFAULT 'advisory' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_by" varchar(120) DEFAULT 'System' NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "workforce_timesheet_policy_org_idx"
  ON "workforce_timesheet_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "workforce_timesheets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "status" varchar(24) DEFAULT 'submitted' NOT NULL,
  "scheduled_minutes" integer DEFAULT 0 NOT NULL,
  "worked_minutes" integer DEFAULT 0 NOT NULL,
  "overtime_minutes" integer DEFAULT 0 NOT NULL,
  "exception_count" integer DEFAULT 0 NOT NULL,
  "blocker_count" integer DEFAULT 0 NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "snapshot_hash" varchar(64) NOT NULL,
  "submitted_by" varchar(120),
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "submitted_at" timestamptz,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_timesheet_period_version_unique"
  ON "workforce_timesheets" ("organization_id", "employee_id", "period_start", "period_end", "version");
CREATE INDEX IF NOT EXISTS "workforce_timesheet_org_period_idx"
  ON "workforce_timesheets" ("organization_id", "period_start", "period_end");
CREATE INDEX IF NOT EXISTS "workforce_timesheet_status_idx"
  ON "workforce_timesheets" ("organization_id", "status");
