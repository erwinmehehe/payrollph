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
