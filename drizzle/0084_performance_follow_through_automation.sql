-- HCM performance follow-through automation:
-- overdue 1:1 action reminders/escalations, skill development plans,
-- and completed-cycle evidence retention/sealing.

CREATE TABLE IF NOT EXISTS "performance_action_reminder_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "version" integer NOT NULL DEFAULT 1,
  "enabled" boolean NOT NULL DEFAULT true,
  "reminder_days_before" integer NOT NULL DEFAULT 3,
  "escalation_days_overdue" integer NOT NULL DEFAULT 3,
  "notify_manager_on_employee_item" boolean NOT NULL DEFAULT true,
  "notify_people_admin_on_escalation" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_name" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_action_reminder_policy_days_before_check"
    CHECK ("reminder_days_before" >= 0 AND "reminder_days_before" <= 30),
  CONSTRAINT "performance_action_reminder_policy_escalation_check"
    CHECK ("escalation_days_overdue" >= 1 AND "escalation_days_overdue" <= 90)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_action_reminder_policies_org_unique"
  ON "performance_action_reminder_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "performance_action_reminder_policy_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "performance_action_reminder_policies"("id") ON DELETE restrict,
  "from_version" integer,
  "to_version" integer NOT NULL,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "performance_action_item_reminder_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "action_item_id" integer NOT NULL REFERENCES "performance_one_on_one_action_items"("id") ON DELETE cascade,
  "one_on_one_id" integer NOT NULL REFERENCES "performance_one_on_ones"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "source_key" varchar(180) NOT NULL,
  "stage" varchar(32) NOT NULL,
  "due_date" date NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "owner_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "owner_name" varchar(120),
  "manager_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "manager_name" varchar(120),
  "escalated_to_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "escalated_to_name" varchar(120),
  "notification_episode" integer NOT NULL DEFAULT 1,
  "last_notified_at" timestamptz,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_action_item_reminder_stage_check"
    CHECK ("stage" IN ('upcoming','due','overdue','overdue_escalated')),
  CONSTRAINT "performance_action_item_reminder_status_check"
    CHECK ("status" IN ('open','resolved')),
  CONSTRAINT "performance_action_item_reminder_episode_check"
    CHECK ("notification_episode" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_action_item_reminder_source_unique"
  ON "performance_action_item_reminder_tasks" ("organization_id","source_key");
CREATE INDEX IF NOT EXISTS "performance_action_item_reminder_status_idx"
  ON "performance_action_item_reminder_tasks" ("organization_id","status","due_date","stage");

CREATE TABLE IF NOT EXISTS "performance_action_item_reminder_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" integer NOT NULL REFERENCES "performance_action_item_reminder_tasks"("id") ON DELETE cascade,
  "action_item_id" integer NOT NULL REFERENCES "performance_one_on_one_action_items"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "performance_action_item_reminder_events_task_idx"
  ON "performance_action_item_reminder_events" ("organization_id","task_id","created_at");

CREATE TABLE IF NOT EXISTS "performance_skill_development_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "hcm_skills"("id") ON DELETE restrict,
  "source_cycle_id" integer REFERENCES "performance_cycles"("id") ON DELETE set null,
  "source_review_item_id" integer REFERENCES "performance_review_items"("id") ON DELETE set null,
  "source_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "title" varchar(220) NOT NULL,
  "objective" text NOT NULL,
  "current_proficiency" numeric(4,2),
  "target_proficiency" numeric(4,2) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'planned',
  "target_date" date NOT NULL,
  "manager_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "employee_visible" boolean NOT NULL DEFAULT true,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_skill_development_plan_status_check"
    CHECK ("status" IN ('planned','in_progress','completed','cancelled')),
  CONSTRAINT "performance_skill_development_plan_target_check"
    CHECK ("target_proficiency" >= 1 AND "target_proficiency" <= 5),
  CONSTRAINT "performance_skill_development_plan_current_check"
    CHECK ("current_proficiency" IS NULL OR ("current_proficiency" >= 1 AND "current_proficiency" <= 5))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_skill_development_plan_open_unique"
  ON "performance_skill_development_plans" ("organization_id","employee_id","skill_id")
  WHERE "status" IN ('planned','in_progress');
CREATE INDEX IF NOT EXISTS "performance_skill_development_plan_status_idx"
  ON "performance_skill_development_plans" ("organization_id","employee_id","status","target_date");

CREATE TABLE IF NOT EXISTS "performance_skill_development_milestones" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "performance_skill_development_plans"("id") ON DELETE cascade,
  "title" varchar(220) NOT NULL,
  "detail" text,
  "due_date" date NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "completed_at" timestamptz,
  "completed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "completed_by_name" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_skill_development_milestone_status_check"
    CHECK ("status" IN ('open','in_progress','completed','cancelled'))
);
CREATE INDEX IF NOT EXISTS "performance_skill_development_milestone_plan_idx"
  ON "performance_skill_development_milestones" ("organization_id","plan_id","status","due_date");

CREATE TABLE IF NOT EXISTS "performance_skill_development_progress" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "performance_skill_development_plans"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "author_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "author_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "author_name" varchar(120) NOT NULL,
  "progress_percent" integer,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_skill_development_progress_percent_check"
    CHECK ("progress_percent" IS NULL OR ("progress_percent" >= 0 AND "progress_percent" <= 100))
);
CREATE INDEX IF NOT EXISTS "performance_skill_development_progress_plan_idx"
  ON "performance_skill_development_progress" ("organization_id","plan_id","created_at");

CREATE TABLE IF NOT EXISTS "performance_skill_development_plan_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "performance_skill_development_plans"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "note" text,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "performance_skill_development_plan_events_plan_idx"
  ON "performance_skill_development_plan_events" ("organization_id","plan_id","created_at");

CREATE TABLE IF NOT EXISTS "performance_evidence_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "version" integer NOT NULL DEFAULT 1,
  "retention_years" integer NOT NULL DEFAULT 7,
  "auto_seal_completed_cycles" boolean NOT NULL DEFAULT true,
  "allow_post_seal_amendments" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_name" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_evidence_policy_retention_check"
    CHECK ("retention_years" >= 1 AND "retention_years" <= 20)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_evidence_policies_org_unique"
  ON "performance_evidence_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "performance_evidence_policy_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "performance_evidence_policies"("id") ON DELETE restrict,
  "from_version" integer,
  "to_version" integer NOT NULL,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "performance_cycle_evidence_seals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE restrict,
  "policy_version" integer NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_hash" varchar(64) NOT NULL,
  "sealed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "sealed_by_name" varchar(120) NOT NULL,
  "sealed_at" timestamptz NOT NULL DEFAULT now(),
  "retention_until" date NOT NULL,
  "legal_hold" boolean NOT NULL DEFAULT false,
  "legal_hold_reason" text,
  "legal_hold_set_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "legal_hold_set_by_name" varchar(120),
  "legal_hold_set_at" timestamptz,
  "latest_amendment_number" integer NOT NULL DEFAULT 0,
  "last_verified_at" timestamptz,
  "last_verification_status" varchar(24),
  "last_verified_hash" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_cycle_evidence_seal_verification_check"
    CHECK ("last_verification_status" IS NULL OR "last_verification_status" IN ('match','mismatch'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_cycle_evidence_seals_cycle_unique"
  ON "performance_cycle_evidence_seals" ("organization_id","cycle_id");
CREATE INDEX IF NOT EXISTS "performance_cycle_evidence_seals_retention_idx"
  ON "performance_cycle_evidence_seals" ("organization_id","retention_until","legal_hold");

CREATE TABLE IF NOT EXISTS "performance_cycle_evidence_amendments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "seal_id" integer NOT NULL REFERENCES "performance_cycle_evidence_seals"("id") ON DELETE restrict,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE restrict,
  "amendment_number" integer NOT NULL,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "reason" varchar(500) NOT NULL,
  "detail" text NOT NULL,
  "previous_chain_hash" varchar(64) NOT NULL,
  "amendment_hash" varchar(64) NOT NULL,
  "chain_hash" varchar(64) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_cycle_evidence_amendments_number_unique"
  ON "performance_cycle_evidence_amendments" ("seal_id","amendment_number");
CREATE INDEX IF NOT EXISTS "performance_cycle_evidence_amendments_cycle_idx"
  ON "performance_cycle_evidence_amendments" ("organization_id","cycle_id","created_at");
