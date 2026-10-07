-- Connect authoritative HCM workforce plans/positions to operational WFM staffing demand.

ALTER TABLE "staffing_requirements"
  ADD COLUMN IF NOT EXISTS "source_type" varchar(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "source_plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "source_position_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "source_handoff_key" varchar(180);

CREATE INDEX IF NOT EXISTS "staffing_requirement_source_plan_idx"
  ON "staffing_requirements" ("organization_id", "source_plan_id", "work_date");

CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_handoff_key_unique"
  ON "staffing_requirements" ("organization_id", "source_handoff_key")
  WHERE "source_handoff_key" IS NOT NULL;
