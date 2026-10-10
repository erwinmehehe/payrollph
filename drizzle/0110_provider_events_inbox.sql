-- A-1 / provider webhook inbox. 0110 is reserved AFTER pending PR #739's
-- 0109 tamper-evident audit migration; DBA must reconcile/apply ordered history.
-- This migration must NOT be automatically applied by PR/CI or to production.
CREATE TABLE IF NOT EXISTS "provider_events" (
  "id" serial PRIMARY KEY,
  "provider" varchar(32) NOT NULL,
  "event_id" varchar(180) NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "payroll_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "event_type" varchar(120) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_events_provider_event_id_unique"
  ON "provider_events" ("provider", "event_id");
CREATE INDEX IF NOT EXISTS "provider_events_organization_run_idx"
  ON "provider_events" ("organization_id", "payroll_run_id");
