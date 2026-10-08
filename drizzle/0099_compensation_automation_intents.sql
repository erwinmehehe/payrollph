-- Durable post-commit automation handoff for applied salary changes and
-- activated recurring compensation. No historical events are backfilled:
-- original automation delivery cannot be proven for legacy records.
CREATE TABLE IF NOT EXISTS "compensation_automation_intents" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "compensation_event_id" integer NOT NULL REFERENCES "compensation_events"("id") ON DELETE cascade,
  "trigger" varchar(64) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "lease_until" timestamptz,
  "last_error" text,
  "dispatched_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comp_automation_intent_status_check"
    CHECK ("status" IN ('pending','retry','leased','dispatched','needs_review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "comp_automation_intent_key_unique"
  ON "compensation_automation_intents" ("organization_id","trigger","event_key");
CREATE INDEX IF NOT EXISTS "comp_automation_intent_retry_idx"
  ON "compensation_automation_intents" ("status","next_attempt_at");
CREATE INDEX IF NOT EXISTS "comp_automation_intent_source_idx"
  ON "compensation_automation_intents" ("organization_id","compensation_event_id");
