-- Automation Studio impact preview foundation: immutable authoritative-event ledger.

CREATE TABLE IF NOT EXISTS "automation_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "trigger" varchar(64) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_event_log_org_trigger_event_unique"
  ON "automation_event_log" ("organization_id","trigger","event_key");

CREATE INDEX IF NOT EXISTS "automation_event_log_org_trigger_occurred_idx"
  ON "automation_event_log" ("organization_id","trigger","occurred_at" DESC);

-- The ledger is append-only by application design. It records authoritative
-- event context whether or not any Automation Studio rule matches.
