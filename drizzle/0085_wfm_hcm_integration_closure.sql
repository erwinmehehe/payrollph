-- Close the HCM -> WFM planning boundary with explicit position demand rules.
-- A position never guesses a worksite or shift; approved/open headcount must be
-- intentionally mapped to governed WFM coverage before requirements are materialized.

CREATE TABLE IF NOT EXISTS "position_wfm_demand_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE restrict,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE restrict,
  "weekdays" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "required_headcount" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "position_wfm_demand_rule_scope_unique"
  ON "position_wfm_demand_rules" ("position_id","worksite_id","shift_definition_id","effective_from");

CREATE INDEX IF NOT EXISTS "position_wfm_demand_rule_org_active_idx"
  ON "position_wfm_demand_rules" ("organization_id","active","effective_from");

ALTER TABLE "staffing_requirements"
  ADD COLUMN IF NOT EXISTS "source_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "source_demand_rule_id" integer REFERENCES "position_wfm_demand_rules"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "source_kind" varchar(32) NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirements_position_rule_date_unique"
  ON "staffing_requirements" ("source_demand_rule_id","work_date")
  WHERE "source_demand_rule_id" IS NOT NULL;
