-- F-04: append-only history of committed payroll calculation revisions.
-- Reviewed forward migration only. Never apply by app request, db:push, or
-- directly to a live/production Neon branch without separate DBA authorization.
-- No historical backfill: existing mutable registers cannot prove past revisions.
--
-- Deliberately denormalized run/job/worker/legal-entity IDs: deleting a draft
-- run, job, or employee must NOT erase previously committed calculations.
-- Whole-tenant removal remains a separate privacy/retention purge boundary.

CREATE TABLE public.payroll_calculation_history (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id integer,
  payroll_run_id integer NOT NULL,
  payroll_job_id integer NOT NULL,
  employee_id integer NOT NULL,
  revision integer NOT NULL,
  previous_snapshot_hash varchar(64),
  snapshot_hash varchar(64) NOT NULL,
  period_label varchar(80) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NOT NULL,
  rule_version varchar(48) NOT NULL,
  gross_pay numeric(12,2) NOT NULL,
  deductions numeric(12,2) NOT NULL,
  net_pay numeric(12,2) NOT NULL,
  status varchar(32) NOT NULL,
  line_items jsonb NOT NULL,
  trace jsonb NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payroll_calculation_history_revision_check CHECK (revision > 0),
  CONSTRAINT payroll_calculation_history_hash_check
    CHECK (snapshot_hash ~ '^[0-9a-f]{64}$' AND
      (previous_snapshot_hash IS NULL OR previous_snapshot_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT payroll_calculation_history_period_check CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX payroll_calculation_history_job_employee_unique
  ON public.payroll_calculation_history(payroll_job_id, employee_id);
CREATE UNIQUE INDEX payroll_calculation_history_run_employee_revision_unique
  ON public.payroll_calculation_history(payroll_run_id, employee_id, revision);
CREATE INDEX payroll_calculation_history_org_run_read_idx
  ON public.payroll_calculation_history(organization_id, payroll_run_id, id DESC);

-- Database backstop: no cross-tenant or cross-legal-employer history writes;
-- revisions must form an uninterrupted prior-hash chain for each run/worker.
CREATE FUNCTION public.payroll_calculation_history_validate_insert()
RETURNS trigger LANGUAGE plpgsql AS $history_insert$
DECLARE
  prior_revision integer;
  prior_hash varchar(64);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payroll_runs r
    JOIN public.payroll_jobs j ON j.payroll_run_id = r.id
    JOIN public.employees e ON e.id = NEW.employee_id
    WHERE r.id = NEW.payroll_run_id
      AND r.organization_id = NEW.organization_id
      AND r.legal_entity_id IS NOT DISTINCT FROM NEW.legal_entity_id
      AND r.period_label = NEW.period_label
      AND r.period_start = NEW.period_start
      AND r.period_end = NEW.period_end
      AND r.pay_date = NEW.pay_date
      AND r.rule_version = NEW.rule_version
      AND j.id = NEW.payroll_job_id
      AND j.organization_id = NEW.organization_id
      AND j.status = 'processing'
      AND e.organization_id = NEW.organization_id
      AND e.legal_entity_id IS NOT DISTINCT FROM NEW.legal_entity_id
  ) THEN
    RAISE EXCEPTION 'PAYROLL_HISTORY_SCOPE_OR_SOURCE_MISMATCH';
  END IF;

  SELECT h.revision, h.snapshot_hash INTO prior_revision, prior_hash
  FROM public.payroll_calculation_history h
  WHERE h.payroll_run_id = NEW.payroll_run_id AND h.employee_id = NEW.employee_id
  ORDER BY h.revision DESC LIMIT 1;

  IF NEW.revision <> COALESCE(prior_revision, 0) + 1
    OR NEW.previous_snapshot_hash IS DISTINCT FROM prior_hash THEN
    RAISE EXCEPTION 'PAYROLL_HISTORY_REVISION_CHAIN_INVALID';
  END IF;
  RETURN NEW;
END $history_insert$;

CREATE TRIGGER payroll_calculation_history_validate_insert
BEFORE INSERT ON public.payroll_calculation_history
FOR EACH ROW EXECUTE FUNCTION public.payroll_calculation_history_validate_insert();

-- Deny ordinary INSERT-era revision edits/deletes, including direct SQL. The
-- sole exception is FK-driven whole-organization erasure (trigger depth > 1);
-- this is NOT a run/employee recalculation/delete escape hatch.
CREATE FUNCTION public.payroll_calculation_history_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $history_immutable$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PAYROLL_CALCULATION_HISTORY_IMMUTABLE';
END $history_immutable$;

CREATE TRIGGER payroll_calculation_history_no_update_delete
BEFORE UPDATE OR DELETE ON public.payroll_calculation_history
FOR EACH ROW EXECUTE FUNCTION public.payroll_calculation_history_reject_mutation();

CREATE TRIGGER payroll_calculation_history_no_truncate
BEFORE TRUNCATE ON public.payroll_calculation_history
FOR EACH STATEMENT EXECUTE FUNCTION public.payroll_calculation_history_reject_mutation();

-- Ordinary app credentials only get append/read privileges, never mutations.
DO $app_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payrollph_app') THEN
    GRANT SELECT, INSERT ON public.payroll_calculation_history TO payrollph_app;
    GRANT USAGE, SELECT ON SEQUENCE public.payroll_calculation_history_id_seq TO payrollph_app;
  END IF;
END $app_grant$;
