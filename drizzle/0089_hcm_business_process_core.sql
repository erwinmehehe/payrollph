-- Enterprise HCM business-process foundation.
-- Supervisory organizations remain in org_units(type='supervisory'); process definitions
-- can be scoped to one supervisory org and inherit down its parent hierarchy.

CREATE TABLE IF NOT EXISTS "hcm_business_process_definitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "process_type" varchar(48) NOT NULL,
  "supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "version" integer NOT NULL DEFAULT 1,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_bp_definition_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_bp_definitions_org_code_unique"
  ON "hcm_business_process_definitions" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "hcm_bp_definitions_lookup_idx"
  ON "hcm_business_process_definitions"
  ("organization_id","process_type","supervisory_org_unit_id","active","effective_from");

CREATE TABLE IF NOT EXISTS "hcm_business_process_instances" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "definition_id" integer REFERENCES "hcm_business_process_definitions"("id") ON DELETE restrict,
  "definition_code" varchar(64) NOT NULL,
  "definition_version" integer NOT NULL,
  "process_type" varchar(48) NOT NULL,
  "source_type" varchar(48) NOT NULL,
  "source_key" varchar(160) NOT NULL,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "effective_date" date,
  "status" varchar(24) NOT NULL DEFAULT 'in_progress',
  "current_step_index" integer NOT NULL DEFAULT 0,
  "definition_snapshot" jsonb NOT NULL,
  "initiated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "initiated_by_name" varchar(120) NOT NULL,
  "initiated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by_name" varchar(120),
  "cancelled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_bp_instance_status_check"
    CHECK ("status" IN ('in_progress','approved','declined','cancelled','applied','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_bp_instances_source_unique"
  ON "hcm_business_process_instances" ("organization_id","source_type","source_key");
CREATE INDEX IF NOT EXISTS "hcm_bp_instances_status_idx"
  ON "hcm_business_process_instances" ("organization_id","status","initiated_at");
CREATE INDEX IF NOT EXISTS "hcm_bp_instances_employee_idx"
  ON "hcm_business_process_instances" ("organization_id","employee_id","initiated_at");

CREATE TABLE IF NOT EXISTS "hcm_business_process_instance_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "instance_id" integer NOT NULL REFERENCES "hcm_business_process_instances"("id") ON DELETE cascade,
  "step_index" integer NOT NULL,
  "step_type" varchar(24) NOT NULL,
  "label" varchar(120) NOT NULL,
  "assignee" varchar(120) NOT NULL,
  "priority" varchar(16) NOT NULL DEFAULT 'Normal',
  "status" varchar(24) NOT NULL DEFAULT 'waiting',
  "due_at" timestamptz,
  "approval_task_id" integer REFERENCES "approval_tasks"("id") ON DELETE set null,
  "completed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "completed_by_name" varchar(120),
  "completed_at" timestamptz,
  "decision_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_bp_step_type_check"
    CHECK ("step_type" IN ('approval','review','to_do')),
  CONSTRAINT "hcm_bp_step_status_check"
    CHECK ("status" IN ('waiting','pending','completed','declined','cancelled','skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_bp_instance_steps_unique"
  ON "hcm_business_process_instance_steps" ("instance_id","step_index");
CREATE INDEX IF NOT EXISTS "hcm_bp_instance_steps_task_idx"
  ON "hcm_business_process_instance_steps" ("approval_task_id");
CREATE INDEX IF NOT EXISTS "hcm_bp_instance_steps_inbox_idx"
  ON "hcm_business_process_instance_steps" ("organization_id","status","assignee");
