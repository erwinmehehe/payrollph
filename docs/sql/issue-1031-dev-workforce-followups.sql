-- Development only / Issue #1031 stage 2: restore secondary Workforce Planning route dependencies.
-- Builds on docs/sql/issue-1031-dev-workforce-bi-repair.sql which was already
-- applied in the fictional dev environment. This file is NOT a numbered
-- production migration and must never be used to forge historical receipts.
-- Reconciled from 0070, 0071, 0050, 0052, 0039, 0049, 0085 and src/db/schema.ts.
-- Additive DDL only; no user, worker, payroll, role or approval records are seeded.

DO $guard$ BEGIN
 IF to_regclass('public.organizations') IS NULL
 OR to_regclass('public.users') IS NULL
 OR to_regclass('public.employees') IS NULL
 OR to_regclass('public.approval_tasks') IS NULL
 OR to_regclass('public.positions') IS NULL
 OR to_regclass('public.position_assignments') IS NULL
 OR to_regclass('public.job_profiles') IS NULL
 OR to_regclass('public.workforce_plans') IS NULL
 OR to_regclass('public.worksites') IS NULL
 OR to_regclass('public.shift_definitions') IS NULL THEN
   RAISE EXCEPTION 'ISSUE_1031_FOLLOWUP_BASE_DEPENDENCY_MISSING';
 END IF;
 IF to_regclass('public.approval_chain_policies') IS NOT NULL
 OR to_regclass('public.approval_chain_instances') IS NOT NULL
 OR to_regclass('public.approval_chain_instance_steps') IS NOT NULL
 OR to_regclass('public.staffing_requirements') IS NOT NULL
 OR to_regclass('public.worker_employment_events') IS NOT NULL
 OR to_regclass('public.worker_effective_changes') IS NOT NULL THEN
   RAISE EXCEPTION 'ISSUE_1031_FOLLOWUP_ALREADY_OR_PARTIALLY_REPAIRED';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS "approval_chain_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "purpose" varchar(40) NOT NULL DEFAULT 'automation',
  "version" integer NOT NULL DEFAULT 1,
  "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "approval_chain_policies_org_code_unique"
  ON "approval_chain_policies" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "approval_chain_policies_org_active_idx"
  ON "approval_chain_policies" ("organization_id","active","purpose");

CREATE TABLE IF NOT EXISTS "approval_chain_instances" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "approval_chain_policies"("id") ON DELETE restrict,
  "policy_code" varchar(64) NOT NULL,
  "policy_version" integer NOT NULL,
  "source_type" varchar(48) NOT NULL,
  "source_key" varchar(160) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','approved','declined','cancelled')),
  "current_step_index" integer NOT NULL DEFAULT 0,
  "steps_snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "approval_chain_instances_source_unique"
  ON "approval_chain_instances" ("organization_id","source_type","source_key");
CREATE INDEX IF NOT EXISTS "approval_chain_instances_status_idx"
  ON "approval_chain_instances" ("organization_id","status","created_at");

CREATE TABLE IF NOT EXISTS "approval_chain_instance_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "instance_id" integer NOT NULL REFERENCES "approval_chain_instances"("id") ON DELETE cascade,
  "step_index" integer NOT NULL,
  "label" varchar(120) NOT NULL,
  "approver" varchar(120) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','approved','declined','cancelled')),
  "approval_task_id" integer REFERENCES "approval_tasks"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "approval_chain_instance_steps_unique"
  ON "approval_chain_instance_steps" ("instance_id","step_index");
CREATE INDEX IF NOT EXISTS "approval_chain_instance_steps_task_idx"
  ON "approval_chain_instance_steps" ("approval_task_id");

ALTER TABLE "approval_chain_instances"
 ADD COLUMN IF NOT EXISTS "amount" numeric(14,2),
 ADD COLUMN IF NOT EXISTS "amount_currency" varchar(3),
 ADD COLUMN IF NOT EXISTS "amount_basis" varchar(64),
 ADD COLUMN IF NOT EXISTS "routing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "approval_chain_instances" ADD CONSTRAINT "approval_chain_instances_amount_nonnegative_check"
 CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_chain_instance_fk"
 FOREIGN KEY ("approval_chain_instance_id") REFERENCES "approval_chain_instances"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "worker_employment_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_date" date NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "position_assignment_id" integer REFERENCES "position_assignments"("id") ON DELETE set null,
  "from_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "to_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "from_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "to_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "from_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "to_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "from_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "to_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "from_employment_type" varchar(32),
  "to_employment_type" varchar(32),
  "from_status" varchar(32),
  "to_status" varchar(32),
  "reason" varchar(240) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "worker_employment_events_employee_date_idx"
  ON "worker_employment_events" ("organization_id", "employee_id", "effective_date");

CREATE INDEX IF NOT EXISTS "worker_employment_events_org_type_idx"
  ON "worker_employment_events" ("organization_id", "event_type");

CREATE TABLE IF NOT EXISTS "worker_effective_changes" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "change_type" varchar(32) DEFAULT 'job_change' NOT NULL,
  "movement_type" varchar(24) DEFAULT 'job_change' NOT NULL,
  "effective_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'pending_approval' NOT NULL,
  "target_position_id" integer REFERENCES "positions"("id") ON DELETE restrict,
  "target_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  "target_cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE restrict,
  "target_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE restrict,
  "target_employment_type" varchar(32),
  "target_employee_status" varchar(32),
  "target_fte" numeric(5,4),
  "reason" varchar(240) NOT NULL,
  "from_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "to_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "applied_event_id" integer REFERENCES "worker_employment_events"("id") ON DELETE set null,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamp with time zone,
  "failure" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "worker_effective_changes_org_status_date_idx"
  ON "worker_effective_changes" ("organization_id","status","effective_date");
CREATE INDEX IF NOT EXISTS "worker_effective_changes_employee_date_idx"
  ON "worker_effective_changes" ("organization_id","employee_id","effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_employee_unique"
  ON "worker_effective_changes" ("organization_id","employee_id")
  WHERE "status" IN ('pending_approval','scheduled');
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_target_position_unique"
  ON "worker_effective_changes" ("target_position_id")
  WHERE "target_position_id" IS NOT NULL
    AND "status" IN ('pending_approval','scheduled');

CREATE TABLE IF NOT EXISTS "staffing_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE restrict,
  "job_profile_id" integer REFERENCES "job_profiles"("id") ON DELETE restrict,
  "required_headcount" integer NOT NULL,
  "source_type" varchar(32) NOT NULL DEFAULT 'manual',
  "source_plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "source_position_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source_handoff_key" varchar(180),
  "notes" varchar(240),
  "created_by" varchar(120) NOT NULL DEFAULT 'System',
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_role_unique"
 ON "staffing_requirements" ("organization_id", "worksite_id", "work_date", "shift_definition_id",coalesce("job_profile_id", 0));
CREATE INDEX IF NOT EXISTS "staffing_requirement_date_idx"
 ON "staffing_requirements" ("organization_id", "work_date");
CREATE INDEX IF NOT EXISTS "staffing_requirement_role_idx"
 ON "staffing_requirements" ("organization_id","job_profile_id","work_date");
CREATE INDEX IF NOT EXISTS "staffing_requirement_source_plan_idx"
 ON "staffing_requirements" ("organization_id","source_plan_id","work_date");
CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_handoff_key_unique"
 ON "staffing_requirements" ("organization_id","source_handoff_key") WHERE "source_handoff_key" IS NOT NULL;
