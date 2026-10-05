CREATE TABLE IF NOT EXISTS "workforce_schedule_guardrail_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "minimum_rest_minutes" integer DEFAULT 0 NOT NULL,
  "max_consecutive_working_days" integer DEFAULT 0 NOT NULL,
  "rolling_seven_day_minutes" integer DEFAULT 0 NOT NULL,
  "enforcement_mode" varchar(24) DEFAULT 'advisory' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "workforce_schedule_guardrail_policy_org_idx"
  ON "workforce_schedule_guardrail_policies" ("organization_id");
