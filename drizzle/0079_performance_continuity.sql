-- HCM performance continuity: manager 1:1s, append-only feedback, and durable
-- review reminders. These records never mutate compensation or payroll.

CREATE TABLE IF NOT EXISTS "performance_one_on_ones" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "manager_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "scheduled_for" timestamptz NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'scheduled',
  "agenda" text,
  "shared_summary" text,
  "private_manager_notes" text,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_one_on_ones_status_check"
    CHECK ("status" IN ('scheduled','completed','cancelled'))
);
CREATE INDEX IF NOT EXISTS "performance_one_on_ones_org_employee_idx"
  ON "performance_one_on_ones" ("organization_id","employee_id","scheduled_for");
CREATE INDEX IF NOT EXISTS "performance_one_on_ones_manager_idx"
  ON "performance_one_on_ones" ("organization_id","manager_user_id","status","scheduled_for");

CREATE TABLE IF NOT EXISTS "performance_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "goal_id" integer REFERENCES "performance_goals"("id") ON DELETE set null,
  "author_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "author_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "author_name" varchar(120) NOT NULL,
  "feedback_type" varchar(24) NOT NULL,
  "visibility" varchar(24) NOT NULL DEFAULT 'employee_shared',
  "content" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_feedback_type_check"
    CHECK ("feedback_type" IN ('praise','coaching','development','general')),
  CONSTRAINT "performance_feedback_visibility_check"
    CHECK ("visibility" IN ('employee_shared','manager_private'))
);
CREATE INDEX IF NOT EXISTS "performance_feedback_org_employee_idx"
  ON "performance_feedback" ("organization_id","employee_id","occurred_at");
CREATE INDEX IF NOT EXISTS "performance_feedback_org_author_idx"
  ON "performance_feedback" ("organization_id","author_user_id","occurred_at");

CREATE TABLE IF NOT EXISTS "performance_reminder_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "performance_reviews"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "reminder_type" varchar(32) NOT NULL,
  "source_key" varchar(160) NOT NULL,
  "stage" varchar(32) NOT NULL,
  "due_date" date NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "owner_name" varchar(120),
  "notification_episode" integer NOT NULL DEFAULT 1,
  "last_notified_at" timestamptz,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_reminder_type_check"
    CHECK ("reminder_type" IN ('self_assessment','manager_review')),
  CONSTRAINT "performance_reminder_status_check"
    CHECK ("status" IN ('open','resolved')),
  CONSTRAINT "performance_reminder_episode_check"
    CHECK ("notification_episode" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_reminder_source_unique"
  ON "performance_reminder_tasks" ("organization_id","source_key");
CREATE INDEX IF NOT EXISTS "performance_reminder_status_idx"
  ON "performance_reminder_tasks" ("organization_id","status","due_date","stage");
CREATE INDEX IF NOT EXISTS "performance_reminder_owner_idx"
  ON "performance_reminder_tasks" ("organization_id","owner_user_id","status");

CREATE TABLE IF NOT EXISTS "performance_reminder_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" integer NOT NULL REFERENCES "performance_reminder_tasks"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "performance_reviews"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "performance_reminder_events_task_idx"
  ON "performance_reminder_events" ("organization_id","task_id","created_at");
