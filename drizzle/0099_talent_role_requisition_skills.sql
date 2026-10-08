-- Role competency snapshot frozen as a new governed requisition opens.
-- Nullable for legacy requisitions; no employee review or private
-- development-plan information is stored in Recruitment.
ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "role_skill_snapshot" jsonb;

COMMENT ON COLUMN "job_requisitions"."role_skill_snapshot"
  IS 'Immutable role-only job profile skill expectations captured at requisition opening; no employee performance data.';
