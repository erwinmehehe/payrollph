-- Automation Studio impact preview foundation: immutable authoritative-event ledger.

CREATE TABLE IF NOT EXISTS "automation_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "trigger" varchar(64) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "source" varchar(32) NOT NULL DEFAULT 'authoritative',
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_event_log_org_trigger_event_unique"
  ON "automation_event_log" ("organization_id","trigger","event_key");

CREATE INDEX IF NOT EXISTS "automation_event_log_org_trigger_occurred_idx"
  ON "automation_event_log" ("organization_id","trigger","occurred_at" DESC);

-- The ledger is append-only by application design. It records authoritative
-- event context whether or not any Automation Studio rule matches.


-- Seed the ledger with the event contexts that were already preserved on
-- historical executions. These rows are necessarily matched-only history;
-- new events are captured before rule matching by the runtime.
INSERT INTO "automation_event_log" (
  "organization_id",
  "employee_id",
  "trigger",
  "event_key",
  "source",
  "context",
  "occurred_at"
)
SELECT DISTINCT ON ("organization_id", "trigger", "event_key")
  "organization_id",
  "employee_id",
  "trigger",
  "event_key",
  'execution_backfill',
  "context",
  "created_at"
FROM "automation_executions"
ORDER BY "organization_id", "trigger", "event_key", "created_at" ASC
ON CONFLICT ("organization_id", "trigger", "event_key") DO NOTHING;
