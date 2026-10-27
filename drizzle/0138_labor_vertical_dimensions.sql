-- #188 ADDITIVE SOURCE CANDIDATE — must not execute against original Neon
-- without independent DBA history reconciliation, target identity verification,
-- preflight, approved SQL hash and operator-controlled forward migration.
-- Old rows remain null; no monetary values, released payroll or allocations
-- are backfilled, recalculated or mutated.
ALTER TABLE public.employee_labor_allocations
  ADD COLUMN IF NOT EXISTS vertical_dimensions jsonb;

DO $vertical_dims$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.employee_labor_allocations'::regclass
      AND conname = 'employee_labor_allocations_vertical_dims_object_chk'
  ) THEN
    ALTER TABLE public.employee_labor_allocations
      ADD CONSTRAINT employee_labor_allocations_vertical_dims_object_chk
      CHECK (vertical_dimensions IS NULL OR jsonb_typeof(vertical_dimensions) = 'object');
  END IF;
END
$vertical_dims$;
