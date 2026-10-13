-- ISSUE #910 — REVIEW-ONLY post-0121 tenant/entity integrity proposal.
-- UNNUMBERED. DO NOT APPLY on Neon, staging, a real employer clone, or production.
-- Existing historical migration files remain immutable. 0121 predecessor evidence
-- and review must be complete before any separate DBA-approved forward migration.
-- All FKs are NOT VALID to protect against retroactively inventing attribution:
-- they protect NEW operations, but old rows require a separate audit + VALIDATE.
-- These constraints are proposed for controlled PostgreSQL16/18 synthetic tests.
CREATE UNIQUE INDEX IF NOT EXISTS employee_org_id_for_entity_scope ON employees(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS user_org_id_for_entity_scope ON user_organizations(organization_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_employer_identity_unique ON payroll_runs(id,legal_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_entry_employer_identity_unique ON payroll_entries(id,legal_entity_id);
DO $issue910_scope$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.employees'::regclass AND conname='employees_tenant_employer_fk') THEN
  ALTER TABLE employees ADD CONSTRAINT employees_tenant_employer_fk
    FOREIGN KEY (organization_id,legal_entity_id) REFERENCES legal_entities(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_runs'::regclass AND conname='payroll_runs_tenant_employer_fk') THEN
  ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_tenant_employer_fk
    FOREIGN KEY (organization_id,legal_entity_id) REFERENCES legal_entities(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.employee_entity_assignments'::regclass AND conname='assignment_employee_tenant_fk') THEN
  ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_employee_tenant_fk
    FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.entity_transfer_requests'::regclass AND conname='transfer_employee_tenant_fk') THEN
  ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_employee_tenant_fk
    FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.user_legal_entity_grants'::regclass AND conname='entity_grant_membership_tenant_fk') THEN
  ALTER TABLE user_legal_entity_grants ADD CONSTRAINT entity_grant_membership_tenant_fk
    FOREIGN KEY (organization_id,user_id) REFERENCES user_organizations(organization_id,user_id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.user_entity_preferences'::regclass AND conname='entity_preference_membership_tenant_fk') THEN
  ALTER TABLE user_entity_preferences ADD CONSTRAINT entity_preference_membership_tenant_fk
    FOREIGN KEY (organization_id,user_id) REFERENCES user_organizations(organization_id,user_id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_entries'::regclass AND conname='payroll_entries_run_employer_fk') THEN
  ALTER TABLE payroll_entries ADD CONSTRAINT payroll_entries_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payslips'::regclass AND conname='payslips_entry_employer_fk') THEN
  ALTER TABLE payslips ADD CONSTRAINT payslips_entry_employer_fk
    FOREIGN KEY (payroll_entry_id,legal_entity_id) REFERENCES payroll_entries(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_jobs'::regclass AND conname='payroll_jobs_run_employer_fk') THEN
  ALTER TABLE payroll_jobs ADD CONSTRAINT payroll_jobs_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payout_batches'::regclass AND conname='payout_batches_run_employer_fk') THEN
  ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payout_transfers'::regclass AND conname='payout_transfers_run_employer_fk') THEN
  ALTER TABLE payout_transfers ADD CONSTRAINT payout_transfers_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.bank_file_validations'::regclass AND conname='bank_file_validations_run_employer_fk') THEN
  ALTER TABLE bank_file_validations ADD CONSTRAINT bank_file_validations_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.year_end_adjustments'::regclass AND conname='year_end_adjustments_run_employer_fk') THEN
  ALTER TABLE year_end_adjustments ADD CONSTRAINT year_end_adjustments_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
END $issue910_scope$;
