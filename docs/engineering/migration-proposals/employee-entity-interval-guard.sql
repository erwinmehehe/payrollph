-- UNNUMBERED DBA-REVIEW PROPOSAL ONLY. DO NOT APPLY TO NEON PRODUCTION.
-- The numbered 0122 slot is already claimed by separate tenant navigation #874;
-- this interval guard must receive its own reviewed contiguous source number
-- after the canonical #865 SQL train and DBA-verified historical receipts.
-- Forward integrity correction; preserve historical 0115-0121 checksums.
-- Requires 0121. No historical employer attribution or backfill is performed.
-- Lock the employee row to serialize concurrent interval inserts/updates.
-- A start-date uniqueness constraint alone permits overlapping closed ranges.
-- Employer ID, effective start, and closed-history rows are immutable.
-- Only a previously open-ended interval can be closed, once; no hard delete.
CREATE OR REPLACE FUNCTION validate_employee_entity_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENTITY_ASSIGNMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  PERFORM e.id FROM public.employees e
    WHERE e.id = NEW.employee_id AND e.organization_id = NEW.organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_ASSIGNMENT_EMPLOYEE_TENANT_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.employee_id IS DISTINCT FROM OLD.employee_id OR
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
    NEW.effective_from IS DISTINCT FROM OLD.effective_from
  ) THEN
    RAISE EXCEPTION 'ENTITY_ASSIGNMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.effective_until IS NOT NULL
      AND NEW.effective_until IS DISTINCT FROM OLD.effective_until THEN
    RAISE EXCEPTION 'ENTITY_ASSIGNMENT_CLOSED_INTERVAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_entity_assignments a
    WHERE a.organization_id = NEW.organization_id AND a.employee_id = NEW.employee_id
      AND a.id IS DISTINCT FROM NEW.id
      AND daterange(a.effective_from, a.effective_until, '[]') &&
          daterange(NEW.effective_from, NEW.effective_until, '[]')
  ) THEN
    RAISE EXCEPTION 'ENTITY_ASSIGNMENT_INTERVAL_OVERLAP' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER employee_entity_assignment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON employee_entity_assignments
  FOR EACH ROW EXECUTE FUNCTION validate_employee_entity_assignment();

