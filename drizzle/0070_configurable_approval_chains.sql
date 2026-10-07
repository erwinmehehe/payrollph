-- Configurable approval chains with immutable per-request snapshots.

ALTER TABLE "approval_tasks"
  ADD COLUMN IF NOT EXISTS "approval_chain_instance_id" integer,
  ADD COLUMN IF NOT EXISTS "approval_chain_step_index" integer;

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

ALTER TABLE "approval_tasks"
  ADD CONSTRAINT "approval_tasks_chain_instance_fk"
  FOREIGN KEY ("approval_chain_instance_id")
  REFERENCES "approval_chain_instances"("id")
  ON DELETE set null;
