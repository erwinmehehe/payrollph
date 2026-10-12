-- WFM roster publish safeguards. Apply under migration runbook before enabling the flag.
CREATE TABLE IF NOT EXISTS "workforce_roster_publish_policies" (
 "organization_id" integer PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
 "max_daily_minutes" integer NOT NULL DEFAULT 720,
 "minimum_rest_minutes" integer NOT NULL DEFAULT 480,
 "max_weekly_minutes" integer NOT NULL DEFAULT 2880,
 "approved_overtime_cap_minutes" integer,
 "enforcement_mode" varchar(16) NOT NULL DEFAULT 'block',
 "active" boolean NOT NULL DEFAULT true,
 "updated_by" varchar(120) NOT NULL,
 "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "wfm_roster_publish_daily_bounds" CHECK ("max_daily_minutes" BETWEEN 0 AND 10080),
 CONSTRAINT "wfm_roster_publish_rest_bounds" CHECK ("minimum_rest_minutes" BETWEEN 0 AND 10080),
 CONSTRAINT "wfm_roster_publish_weekly_bounds" CHECK ("max_weekly_minutes" BETWEEN 0 AND 10080),
 CONSTRAINT "wfm_roster_publish_ot_bounds" CHECK ("approved_overtime_cap_minutes" IS NULL OR "approved_overtime_cap_minutes" BETWEEN 0 AND 10080),
 CONSTRAINT "wfm_roster_publish_enforcement_mode" CHECK ("enforcement_mode" IN ('block','advisory'))
);
