-- #641 governed backdated salary correction cases (additive, forward-only).
-- First forward migration after the clean-baseline cutover (prefix 0134).
-- Apply only through the protected reviewed-migration workflow (plan, then apply).
-- Creates two new tables and grants runtime DML on them to payrollph_app;
-- touches no existing table, row, grant or payroll data.
-- Constraint and index names match the Drizzle declarations in src/db/schema.ts.

CREATE TABLE public.salary_correction_cases (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL,
  legal_entity_id integer NOT NULL,
  employee_id integer NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  effective_date date NOT NULL,
  corrected_pay_basis varchar(16) NOT NULL,
  corrected_rate_amount numeric(12, 2) NOT NULL,
  base_revision_id integer,
  evidence_reference varchar(200) NOT NULL,
  reason varchar(500) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft',
  declared_total numeric(12, 2),
  requested_by_user_id integer NOT NULL,
  requested_by varchar(120) NOT NULL,
  submitted_at timestamp with time zone,
  reviewed_by_user_id integer,
  reviewed_by varchar(120),
  reviewed_at timestamp with time zone,
  review_reason varchar(500),
  cancelled_by_user_id integer,
  cancelled_at timestamp with time zone,
  cancel_reason varchar(500),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT salary_correction_cases_organization_id_organizations_id_fk
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT salary_correction_cases_legal_entity_id_legal_entities_id_fk
    FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_cases_employee_id_employees_id_fk
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_cases_requested_by_user_id_users_id_fk
    FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_cases_reviewed_by_user_id_users_id_fk
    FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_cases_cancelled_by_user_id_users_id_fk
    FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_case_status_check
    CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'cancelled')),
  CONSTRAINT salary_correction_case_basis_check
    CHECK (corrected_pay_basis IN ('monthly', 'daily', 'hourly')),
  CONSTRAINT salary_correction_case_rate_check
    CHECK (corrected_rate_amount > 0 AND corrected_rate_amount <= 100000000),
  CONSTRAINT salary_correction_case_declared_total_check
    CHECK (declared_total IS NULL OR (declared_total >= 0 AND declared_total <= 100000000)),
  CONSTRAINT salary_correction_case_submitted_check
    CHECK (status NOT IN ('submitted', 'approved') OR (submitted_at IS NOT NULL AND declared_total IS NOT NULL)),
  CONSTRAINT salary_correction_case_review_check
    CHECK (status <> 'approved' OR (reviewed_by_user_id IS NOT NULL AND reviewed_by_user_id <> requested_by_user_id))
);

CREATE UNIQUE INDEX salary_correction_case_idempotency_unique
  ON public.salary_correction_cases USING btree (organization_id, idempotency_key);
CREATE UNIQUE INDEX salary_correction_case_one_active_unique
  ON public.salary_correction_cases USING btree (organization_id, employee_id)
  WHERE status IN ('draft', 'submitted', 'changes_requested');
CREATE INDEX salary_correction_case_org_status_idx
  ON public.salary_correction_cases USING btree (organization_id, status, created_at);

CREATE TABLE public.salary_correction_case_runs (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL,
  case_id integer NOT NULL,
  payroll_run_id integer NOT NULL,
  payroll_entry_id integer NOT NULL,
  source_entry_hash varchar(64) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  disposition varchar(16) NOT NULL DEFAULT 'pending',
  underpayment_request_id integer,
  no_shortfall_reason varchar(500),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT salary_correction_case_runs_organization_id_organizations_id_fk
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT salary_correction_case_runs_case_id_salary_correction_cases_id_
    FOREIGN KEY (case_id) REFERENCES public.salary_correction_cases(id) ON DELETE CASCADE,
  CONSTRAINT salary_correction_case_runs_payroll_run_id_payroll_runs_id_fk
    FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_case_runs_payroll_entry_id_payroll_entries_id
    FOREIGN KEY (payroll_entry_id) REFERENCES public.payroll_entries(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_case_runs_underpayment_request_id_payroll_und
    FOREIGN KEY (underpayment_request_id) REFERENCES public.payroll_underpayment_requests(id) ON DELETE RESTRICT,
  CONSTRAINT salary_correction_case_run_disposition_check
    CHECK (disposition IN ('pending', 'underpayment', 'no_shortfall', 'withdrawn')),
  CONSTRAINT salary_correction_case_run_consistency_check
    CHECK ((disposition = 'underpayment' AND underpayment_request_id IS NOT NULL AND no_shortfall_reason IS NULL)
      OR (disposition = 'no_shortfall' AND underpayment_request_id IS NULL
        AND char_length(no_shortfall_reason) BETWEEN 20 AND 500)
      OR (disposition IN ('pending', 'withdrawn') AND underpayment_request_id IS NULL AND no_shortfall_reason IS NULL))
);

CREATE UNIQUE INDEX salary_correction_case_run_unique
  ON public.salary_correction_case_runs USING btree (case_id, payroll_run_id);
CREATE UNIQUE INDEX salary_correction_case_run_request_unique
  ON public.salary_correction_case_runs USING btree (underpayment_request_id)
  WHERE underpayment_request_id IS NOT NULL;
CREATE INDEX salary_correction_case_runs_case_idx
  ON public.salary_correction_case_runs USING btree (case_id);

-- Runtime DML for the application role on the post-cutover target (the cutover
-- sets no default privileges). Disposable databases without that role skip it.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payrollph_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON public.salary_correction_cases, public.salary_correction_case_runs TO payrollph_app;
    GRANT USAGE, SELECT
      ON SEQUENCE public.salary_correction_cases_id_seq, public.salary_correction_case_runs_id_seq TO payrollph_app;
  END IF;
END $grant$;
