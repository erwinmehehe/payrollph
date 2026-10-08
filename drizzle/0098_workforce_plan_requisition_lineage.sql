-- Published plan → approved position → requisition lineage.
-- Historical and unplanned requisitions remain valid; new plan-linked
-- openings require source evidence at transaction time.
ALTER TABLE "job_requisitions"
  ADD COLUMN IF NOT EXISTS "plan_handoff_evidence" jsonb;

COMMENT ON COLUMN "job_requisitions"."plan_handoff_evidence"
  IS 'Immutable HCM published plan/baseline/position execution proof captured at opening. Existing requisitions remain nullable for historical compatibility.';
