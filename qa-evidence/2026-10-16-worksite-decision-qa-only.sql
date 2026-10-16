-- QA BRANCH ONLY (2026-10-16). Do not apply on the default / production-linked Neon branch.
-- App schema: src/db/schema.ts -> employeeWorksiteAssignments.decision
-- Observed: the isolated QA database lacked this column; Live Floor GET failed.
-- Repair was applied to Neon branch br-green-hat-b77qj8fs and Live Floor returned HTTP 200.
-- Production migration approval and release testing are separate, intentionally NOT done.
-- Guarded, idempotent reproduction script for this same isolated QA branch:
DO $qa$
BEGIN
  IF current_setting('neon.project_id',true) <> 'calm-wave-70219564'
  OR current_setting('neon.branch_id',true) <> 'br-green-hat-b77qj8fs'
  OR current_setting('neon.endpoint_id',true) <> 'ep-old-paper-b7k36yuc'
  OR current_database() <> 'neondb'
  THEN RAISE EXCEPTION 'QA-only branch mismatch, refusing change'; END IF;

  ALTER TABLE public.employee_worksite_assignments
  ADD COLUMN IF NOT EXISTS decision varchar(8) NOT NULL DEFAULT 'allow';
END
$qa$;
