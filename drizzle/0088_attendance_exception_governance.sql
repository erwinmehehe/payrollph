-- Add operational ownership, SLA tracking, and resolution evidence to WFM attendance exceptions.

ALTER TABLE "attendance_exception_events"
  ADD COLUMN IF NOT EXISTS "owner_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "owner_name" varchar(120),
  ADD COLUMN IF NOT EXISTS "sla_due_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "resolution_note" text,
  ADD COLUMN IF NOT EXISTS "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "resolved_by_name" varchar(120),
  ADD COLUMN IF NOT EXISTS "resolution_recorded_at" timestamptz;

UPDATE "attendance_exception_events"
SET "sla_due_at" = "first_detected_at" + (
  CASE
    WHEN "severity" = 'blocker' THEN interval '4 hours'
    WHEN "severity" = 'warning' THEN interval '24 hours'
    ELSE interval '72 hours'
  END
)
WHERE "sla_due_at" IS NULL;

CREATE INDEX IF NOT EXISTS "attendance_exception_events_owner_idx"
  ON "attendance_exception_events" ("organization_id","status","owner_user_id","sla_due_at");

CREATE INDEX IF NOT EXISTS "attendance_exception_events_sla_idx"
  ON "attendance_exception_events" ("organization_id","status","sla_due_at");
