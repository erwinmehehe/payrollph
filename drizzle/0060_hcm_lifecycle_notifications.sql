-- HCM Core 3.4: lifecycle notification ownership, acknowledgement, snooze, and escalation.
-- Notifications surface action; they never mutate employment status, terms, decisions, or Separation.

CREATE TABLE IF NOT EXISTS "hcm_lifecycle_notification_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "source_type" varchar(32) NOT NULL,
  "source_id" integer,
  "source_key" varchar(160) NOT NULL,
  "action" varchar(32) NOT NULL,
  "stage" varchar(32) NOT NULL,
  "escalation_stage" integer NOT NULL DEFAULT 0,
  "severity" varchar(16) NOT NULL,
  "title" varchar(180) NOT NULL,
  "detail" varchar(500) NOT NULL,
  "due_date" date,
  "status" varchar(24) NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open','acknowledged','snoozed','resolved')),
  "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "owner_name" varchar(120),
  "acknowledged_at" timestamptz,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "acknowledged_by_name" varchar(120),
  "snooze_until" timestamptz,
  "notification_episode" integer NOT NULL DEFAULT 1,
  "last_notified_at" timestamptz,
  "first_detected_at" timestamptz NOT NULL DEFAULT now(),
  "last_detected_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_lifecycle_notification_escalation_valid" CHECK ("escalation_stage" >= 0),
  CONSTRAINT "hcm_lifecycle_notification_episode_valid" CHECK ("notification_episode" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_lifecycle_notification_source_unique"
  ON "hcm_lifecycle_notification_tasks" ("organization_id","source_key");

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_notification_status_idx"
  ON "hcm_lifecycle_notification_tasks" ("organization_id","status","severity","due_date");

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_notification_owner_idx"
  ON "hcm_lifecycle_notification_tasks" ("organization_id","owner_user_id","status");

CREATE TABLE IF NOT EXISTS "hcm_lifecycle_notification_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" integer NOT NULL REFERENCES "hcm_lifecycle_notification_tasks"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_notification_event_task_idx"
  ON "hcm_lifecycle_notification_events" ("organization_id","task_id","created_at");

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_notification_event_employee_idx"
  ON "hcm_lifecycle_notification_events" ("organization_id","employee_id","created_at");
