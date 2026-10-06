CREATE TABLE IF NOT EXISTS "attendance_capture_policies" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "web_bundy_enabled" boolean NOT NULL DEFAULT true,
  "mobile_clock_enabled" boolean NOT NULL DEFAULT true,
  "kiosk_clock_enabled" boolean NOT NULL DEFAULT false,
  "offline_sync_enabled" boolean NOT NULL DEFAULT false,
  "require_location" boolean NOT NULL DEFAULT false,
  "max_offline_age_minutes" integer NOT NULL DEFAULT 1440,
  "updated_by" varchar(120) NOT NULL DEFAULT 'System',
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "attendance_offline_events" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "client_event_id" varchar(96) NOT NULL,
  "action_type" varchar(24) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "source" varchar(32) NOT NULL,
  "device_serial" varchar(80),
  "location" text,
  "status" varchar(24) NOT NULL DEFAULT 'received',
  "rejection_reason" varchar(240),
  "applied_punch_id" integer REFERENCES "time_punches"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_offline_event_unique"
  ON "attendance_offline_events" ("organization_id", "client_event_id");
CREATE INDEX IF NOT EXISTS "attendance_offline_employee_time_idx"
  ON "attendance_offline_events" ("organization_id", "employee_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "attendance_offline_status_idx"
  ON "attendance_offline_events" ("organization_id", "status");
