-- A-1 / provider webhook inbox. This SQL is a RELEASE CANDIDATE; a contiguous migration number must be reserved AFTER pending PR #739's
-- 0109 tamper-evident audit migration; DBA must reconcile/apply ordered history.
-- This file is deliberately outside drizzle/ because main currently ends at 0108 and 0109 is reserved by PR #739. Assign the next contiguous number only after that predecessor merges; do NOT apply this candidate without independent DBA review.
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
