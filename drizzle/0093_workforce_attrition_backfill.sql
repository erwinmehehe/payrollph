ALTER TABLE "workforce_planning_scenarios"
  ADD COLUMN IF NOT EXISTS "annual_attrition_percent" numeric(7,2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "attrition_backfill_percent" numeric(7,2) DEFAULT '100' NOT NULL;

ALTER TABLE "workforce_planning_scenarios"
  DROP CONSTRAINT IF EXISTS "workforce_scenarios_annual_attrition_check";
ALTER TABLE "workforce_planning_scenarios"
  ADD CONSTRAINT "workforce_scenarios_annual_attrition_check"
  CHECK ("annual_attrition_percent" >= 0 AND "annual_attrition_percent" <= 100);

ALTER TABLE "workforce_planning_scenarios"
  DROP CONSTRAINT IF EXISTS "workforce_scenarios_attrition_backfill_check";
ALTER TABLE "workforce_planning_scenarios"
  ADD CONSTRAINT "workforce_scenarios_attrition_backfill_check"
  CHECK ("attrition_backfill_percent" >= 0 AND "attrition_backfill_percent" <= 100);
