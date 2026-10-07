-- Persist authoritative attendance exceptions and make lifecycle automation event emission idempotent.

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
  "first_detected_at" timestamptz NOT NULL DEFAULT now(),
  "last_detected_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_exception_events_fingerprint_unique"
  ON "attendance_exception_events" ("organization_id","employee_id","work_date","fingerprint_sha256");

CREATE INDEX IF NOT EXISTS "attendance_exception_events_open_idx"
  ON "attendance_exception_events" ("organization_id","status","work_date","employee_id");

CREATE INDEX IF NOT EXISTS "attendance_exception_events_employee_idx"
  ON "attendance_exception_events" ("organization_id","employee_id","work_date");
