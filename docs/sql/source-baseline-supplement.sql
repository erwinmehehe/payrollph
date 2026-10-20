-- Source-first baseline supplement. NOT a numbered migration; never run by the app.
--
-- A database built from src/db/schema.ts (drizzle push) plus drizzle/0109 lacks
-- objects that numbered migrations create but Drizzle cannot express or that
-- schema.ts does not declare: exclusion constraints, tenant-guard triggers,
-- composite tenant/employer foreign keys, CHECK constraints, some indexes and
-- columns read by side schemas (tenant-module-storage, multi-entity registration).
-- Apply this file once, after push + 0109, to build a clean baseline that keeps
-- those protections. Every block below is copied from the named migration;
-- inline CREATE TABLE constraints are restated as ALTER TABLE ... ADD CONSTRAINT.
--
-- Corrections relative to the source migrations:
--   * drizzle/0093 closes "DO $$" with "END $;", which cannot execute; the
--     block below uses "END $$;".
-- Deferred to the restricted-role cutover (see docs/engineering/source-baseline-supplement.md):
--   * drizzle/0133 v2 audit guards (audit_events_protect_v2,
--     audit_events_insert_guard_v2, audit_events_reject_truncate_v2 and their
--     triggers). They require the payrollph_audit_sealing role and sealer login.
--
-- Production remains DBA-gated: use the reviewed migration runner and cutover
-- process. This file is for building and rehearsing a clean baseline.

-- 0001_payroll_periods_rbac.sql: column:payroll_service_mode
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS payroll_service_mode varchar(32) NOT NULL DEFAULT 'self_service',
  ADD COLUMN IF NOT EXISTS payroll_annual_divisor numeric(6,2) NOT NULL DEFAULT 365.00,
  ADD COLUMN IF NOT EXISTS statutory_deduction_mode varchar(32) NOT NULL DEFAULT 'split_evenly';

-- 0001_payroll_periods_rbac.sql: index:payroll_runs_org_period_idx
CREATE INDEX IF NOT EXISTS payroll_runs_org_period_idx ON payroll_runs (organization_id, period_start, period_end);

-- 0001_payroll_periods_rbac.sql: index:payroll_runs_org_scope_idx
CREATE INDEX IF NOT EXISTS payroll_runs_org_scope_idx ON payroll_runs (organization_id, scope_org_unit_id);

-- 0002_final_pay_reconciliation.sql: column:final_pay_breakdown
ALTER TABLE separation_records
  ADD COLUMN IF NOT EXISTS final_pay_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 0010_payroll_policy.sql: constraint:organizations_statutory_deduction_timing_check
alter table organizations
  add constraint organizations_statutory_deduction_timing_check
  check (statutory_deduction_timing in ('split', 'first_cutoff', 'second_cutoff'));

-- 0013_operational_compliance.sql: index:holidays_org_unit_date_idx
CREATE INDEX IF NOT EXISTS holidays_org_unit_date_idx
  ON holidays(organization_id, org_unit_id, holiday_date);

-- 0013_operational_compliance.sql: constraint:organizations_payroll_calendar_mode_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_payroll_calendar_mode_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_payroll_calendar_mode_check
      CHECK (payroll_calendar_mode IN ('flexible', 'ph_semi_monthly'));
  END IF;
END
$compat$;

-- 0013_operational_compliance.sql: constraint:supplementary_earnings_status_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplementary_earnings_status_check'
  ) THEN
    ALTER TABLE supplementary_earnings
      ADD CONSTRAINT supplementary_earnings_status_check
      CHECK (status IN ('pending', 'approved', 'settled', 'void'));
  END IF;
END
$compat$;

-- 0013_operational_compliance.sql: constraint:bank_file_validations_status_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_file_validations_status_check'
  ) THEN
    ALTER TABLE bank_file_validations
      ADD CONSTRAINT bank_file_validations_status_check
      CHECK (status IN ('generated', 'accepted', 'rejected'));
  END IF;
END
$compat$;

-- 0014_year_end_tax_settlement.sql: index:year_end_adjustments_run_status_idx
CREATE INDEX IF NOT EXISTS year_end_adjustments_run_status_idx
  ON year_end_adjustments (payroll_run_id, status);

-- 0014_year_end_tax_settlement.sql: index:year_end_adjustments_org_year_status_idx
CREATE INDEX IF NOT EXISTS year_end_adjustments_org_year_status_idx
  ON year_end_adjustments (organization_id, tax_year, status);

-- 0015_workforce_scheduling.sql: constraint:shift_definitions_break_minutes_check
ALTER TABLE "shift_definitions" ADD CONSTRAINT shift_definitions_break_minutes_check CHECK (break_minutes >= 0);

-- 0015_workforce_scheduling.sql: constraint:schedule_patterns_cycle_days_check
ALTER TABLE "schedule_patterns" ADD CONSTRAINT schedule_patterns_cycle_days_check CHECK (cycle_days BETWEEN 1 AND 56);

-- 0015_workforce_scheduling.sql: constraint:schedule_pattern_days_day_index_check
ALTER TABLE "schedule_pattern_days" ADD CONSTRAINT schedule_pattern_days_day_index_check CHECK (day_index BETWEEN 0 AND 55);

-- 0015_workforce_scheduling.sql: constraint:schedule_pattern_segments_order_check
ALTER TABLE "schedule_pattern_segments" ADD CONSTRAINT schedule_pattern_segments_order_check CHECK (segment_order >= 1);

-- 0015_workforce_scheduling.sql: constraint:employee_schedule_assignments_dates_check
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT employee_schedule_assignments_dates_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from);

-- 0015_workforce_scheduling.sql: constraint:schedule_overrides_kind_check
ALTER TABLE "schedule_overrides" ADD CONSTRAINT schedule_overrides_kind_check
    CHECK (kind IN ('shift', 'split_shift', 'rest_day', 'off', 'location'));

-- 0015_workforce_scheduling.sql: constraint:schedule_overrides_status_check
ALTER TABLE "schedule_overrides" ADD CONSTRAINT schedule_overrides_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- 0020_enterprise_labor_costing.sql: constraint:employee_labor_allocations_percent_check
ALTER TABLE "employee_labor_allocations" ADD CONSTRAINT "employee_labor_allocations_percent_check"
    CHECK ("allocation_percent" > 0 AND "allocation_percent" <= 100);

-- 0020_enterprise_labor_costing.sql: constraint:employee_labor_allocations_dates_check
ALTER TABLE "employee_labor_allocations" ADD CONSTRAINT "employee_labor_allocations_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0024_labor_inspection_readiness.sql: constraint:labor_inspection_remediations_status_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'labor_inspection_remediations_status_check'
  ) THEN
    ALTER TABLE labor_inspection_remediations
      ADD CONSTRAINT labor_inspection_remediations_status_check
      CHECK (status IN ('open', 'acknowledged', 'resolved'));
  END IF;
END
$compat$;

-- 0029_statutory_contribution_issue_events.sql: constraint:statutory_contribution_issue_event_type_check, constraint:statutory_contribution_issue_event_visibility_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_type_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_type_check"
      CHECK ("event_type" IN ('reported', 'review_started', 'payroll_update', 'resolved'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_visibility_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_visibility_check"
      CHECK ("visibility" IN ('employee', 'internal'));
  END IF;
END
$compat$;

-- 0030_labor_inspection_drills.sql: constraint:labor_inspection_drills_status_check
DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'labor_inspection_drills_status_check'
  ) THEN
    ALTER TABLE labor_inspection_drills
      ADD CONSTRAINT labor_inspection_drills_status_check
      CHECK (status IN ('blocked', 'needs-work', 'evidence-ready'));
  END IF;
END
$compat$;

-- 0041_enterprise_pay_rules.sql: constraint:pay_policies_dates_check
ALTER TABLE "pay_policies" ADD CONSTRAINT "pay_policies_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0041_enterprise_pay_rules.sql: constraint:pay_policies_scope_check
ALTER TABLE "pay_policies" ADD CONSTRAINT "pay_policies_scope_check"
    CHECK (
      ("scope_type" = 'organization' AND "scope_org_unit_id" IS NULL AND "scope_employee_id" IS NULL)
      OR ("scope_type" = 'org_unit' AND "scope_org_unit_id" IS NOT NULL AND "scope_employee_id" IS NULL)
      OR ("scope_type" = 'employee' AND "scope_employee_id" IS NOT NULL AND "scope_org_unit_id" IS NULL)
    );

-- 0045_multi_legal_entities.sql: index:employees_legal_entity_idx
CREATE INDEX IF NOT EXISTS "employees_legal_entity_idx"
  ON "employees" ("organization_id", "legal_entity_id");

-- 0045_multi_legal_entities.sql: index:payroll_runs_legal_entity_idx
CREATE INDEX IF NOT EXISTS "payroll_runs_legal_entity_idx"
  ON "payroll_runs" ("organization_id", "legal_entity_id");

-- 0045_multi_legal_entities.sql: constraint:legal_entities_statutory_timing_check
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_statutory_timing_check"
    CHECK ("statutory_deduction_timing" IN ('split', 'first_cutoff', 'second_cutoff'));

-- 0045_multi_legal_entities.sql: constraint:legal_entities_calendar_mode_check
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_calendar_mode_check"
    CHECK ("payroll_calendar_mode" IN ('flexible', 'ph_semi_monthly'));

-- 0046_wfm_staffing_scenarios.sql: constraint:workforce_scenarios_status_check
ALTER TABLE "workforce_planning_scenarios" ADD CONSTRAINT "workforce_scenarios_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected'));

-- 0046_wfm_staffing_scenarios.sql: constraint:workforce_scenarios_growth_check
ALTER TABLE "workforce_planning_scenarios" ADD CONSTRAINT "workforce_scenarios_growth_check"
    CHECK ("demand_growth_percent" >= -50 AND "demand_growth_percent" <= 200);

-- 0046_wfm_staffing_scenarios.sql: constraint:workforce_scenarios_vacancy_fill_check
ALTER TABLE "workforce_planning_scenarios" ADD CONSTRAINT "workforce_scenarios_vacancy_fill_check"
    CHECK ("vacancy_fill_percent" >= 0 AND "vacancy_fill_percent" <= 100);

-- 0046_wfm_staffing_scenarios.sql: constraint:workforce_scenarios_employer_load_check
ALTER TABLE "workforce_planning_scenarios" ADD CONSTRAINT "workforce_scenarios_employer_load_check"
    CHECK ("employer_load_percent" >= 0 AND "employer_load_percent" <= 100);

-- 0047_overtime_budget_controls.sql: constraint:overtime_budget_minutes_check
ALTER TABLE "overtime_budget_policies" ADD CONSTRAINT "overtime_budget_minutes_check" CHECK ("budget_minutes" >= 0 AND "budget_minutes" <= 1000000);

-- 0047_overtime_budget_controls.sql: constraint:overtime_budget_mode_check
ALTER TABLE "overtime_budget_policies" ADD CONSTRAINT "overtime_budget_mode_check" CHECK ("enforcement_mode" IN ('advisory', 'blocking'));

-- 0053_hcm_capability_wfm_eligibility.sql: constraint:hcm_employee_skill_dates_check
ALTER TABLE "hcm_employee_skills" ADD CONSTRAINT "hcm_employee_skill_dates_check" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0055_hcm_worksite_arrangements.sql: constraint:hcm_work_arrangement_valid_dates
ALTER TABLE "hcm_work_arrangements" ADD CONSTRAINT "hcm_work_arrangement_valid_dates" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0055_hcm_worksite_arrangements.sql: constraint:hcm_worksite_authorization_valid_dates
ALTER TABLE "hcm_worksite_authorizations" ADD CONSTRAINT "hcm_worksite_authorization_valid_dates" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0056_hcm_employment_terms.sql: constraint:hcm_employment_terms_valid_range
ALTER TABLE "hcm_employment_terms" ADD CONSTRAINT "hcm_employment_terms_valid_range" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 0056_hcm_employment_terms.sql: constraint:hcm_employment_terms_probation_review_range
ALTER TABLE "hcm_employment_terms" ADD CONSTRAINT "hcm_employment_terms_probation_review_range" CHECK ("probation_review_date" IS NULL OR "probation_review_date" >= "effective_from");

-- 0056_hcm_employment_terms.sql: constraint:hcm_employment_terms_contract_end_range
ALTER TABLE "hcm_employment_terms" ADD CONSTRAINT "hcm_employment_terms_contract_end_range" CHECK ("contract_end_date" IS NULL OR "contract_end_date" >= "effective_from");

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decision_valid_next_range
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decision_valid_next_range" CHECK (
    "next_effective_until" IS NULL OR "next_effective_until" >= "effective_date"
  );

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decision_valid_probation_review
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decision_valid_probation_review" CHECK (
    "next_probation_review_date" IS NULL OR "next_probation_review_date" >= "effective_date"
  );

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decision_valid_contract_end
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decision_valid_contract_end" CHECK (
    "next_contract_end_date" IS NULL OR "next_contract_end_date" >= "effective_date"
  );

-- 0058_hcm_worksite_authorization_decisions.sql: constraint:hcm_worksite_authorization_decision_check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hcm_worksite_authorization_decision_check'
  ) THEN
    ALTER TABLE "hcm_worksite_authorizations"
      ADD CONSTRAINT "hcm_worksite_authorization_decision_check"
      CHECK ("decision" IN ('allow','deny'));
  END IF;
END $$;

-- 0059_hcm_term_separation_linkage.sql: constraint:hcm_employment_term_decision_separation_link_valid
ALTER TABLE "hcm_employment_term_decisions"
  ADD CONSTRAINT "hcm_employment_term_decision_separation_link_valid" CHECK (
    (
      "separation_handoff_status" IN ('none','ready')
      AND "separation_record_id" IS NULL
      AND "separation_handoff_started_at" IS NULL
      AND "separation_handoff_completed_at" IS NULL
    )
    OR
    (
      "separation_handoff_status" = 'started'
      AND "decision_kind" = 'non_renew'
      AND "separation_record_id" IS NOT NULL
      AND "separation_handoff_started_at" IS NOT NULL
      AND "separation_handoff_completed_at" IS NULL
    )
    OR
    (
      "separation_handoff_status" = 'completed'
      AND "decision_kind" = 'non_renew'
      AND "separation_record_id" IS NOT NULL
      AND "separation_handoff_started_at" IS NOT NULL
      AND "separation_handoff_completed_at" IS NOT NULL
    )
  );

-- 0060_hcm_lifecycle_notifications.sql: constraint:hcm_lifecycle_notification_escalation_valid
ALTER TABLE "hcm_lifecycle_notification_tasks" ADD CONSTRAINT "hcm_lifecycle_notification_escalation_valid" CHECK ("escalation_stage" >= 0);

-- 0060_hcm_lifecycle_notifications.sql: constraint:hcm_lifecycle_notification_episode_valid
ALTER TABLE "hcm_lifecycle_notification_tasks" ADD CONSTRAINT "hcm_lifecycle_notification_episode_valid" CHECK ("notification_episode" >= 1);

-- 0061_hcm_precise_leave_intervals.sql: constraint:leave_interval_timing_check
ALTER TABLE "leave_request_intervals" ADD CONSTRAINT "leave_interval_timing_check" CHECK (
    (
      "kind" = 'timed'
      AND "start_local_time" IS NOT NULL
      AND "end_local_time" IS NOT NULL
    )
    OR
    (
      "kind" <> 'timed'
      AND "start_local_time" IS NULL
      AND "end_local_time" IS NULL
      AND "ends_next_day" = false
    )
  );

-- 0064_labor_costing_depth.sql: constraint:employee_labor_allocations_hours_check
ALTER TABLE "employee_labor_allocations"
  ADD CONSTRAINT "employee_labor_allocations_hours_check"
  CHECK (
    ("allocation_basis" = 'percentage' AND "allocation_hours" IS NULL)
    OR ("allocation_basis" = 'hours' AND "allocation_hours" > 0)
  );

-- 0070_configurable_approval_chains.sql: constraint:approval_tasks_chain_instance_fk
ALTER TABLE "approval_tasks"
  ADD CONSTRAINT "approval_tasks_chain_instance_fk"
  FOREIGN KEY ("approval_chain_instance_id")
  REFERENCES "approval_chain_instances"("id")
  ON DELETE set null;

-- 0089_payroll_period_integrity.sql: extension:btree_gist
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 0089_payroll_period_integrity.sql: column:release_period_guard
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS release_period_guard daterange
    GENERATED ALWAYS AS (daterange(period_start, period_end, '[]')) STORED,
  ADD COLUMN IF NOT EXISTS release_scope_guard int4range
    GENERATED ALWAYS AS (
      CASE
        WHEN scope_org_unit_id IS NULL THEN int4range(NULL, NULL, '()')
        ELSE int4range(scope_org_unit_id, scope_org_unit_id, '[]')
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS release_legal_entity_guard bigint
    GENERATED ALWAYS AS (COALESCE(legal_entity_id::bigint, 0::bigint)) STORED;

-- 0089_payroll_period_integrity.sql: constraint:payroll_runs_no_overlapping_release
DO $$
BEGIN
  ALTER TABLE payroll_runs
    ADD CONSTRAINT payroll_runs_no_overlapping_release
    EXCLUDE USING gist (
      organization_id WITH =,
      release_legal_entity_guard WITH =,
      release_period_guard WITH &&,
      release_scope_guard WITH &&
    )
    WHERE (status IN ('Releasing', 'Released'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 0091_rr29_ot_night_meal_allowance.sql: index:de_minimis_active_ot_night_meal_unique
CREATE UNIQUE INDEX IF NOT EXISTS de_minimis_active_ot_night_meal_unique
  ON de_minimis_grants (organization_id, employee_id, benefit_type)
  WHERE active = true AND benefit_type = 'otNightMealAllowance';

-- 0092_payroll_approval_snapshot.sql: index:approval_tasks_payroll_run_idx
CREATE INDEX IF NOT EXISTS approval_tasks_payroll_run_idx
  ON approval_tasks (organization_id, payroll_run_id, id);

-- 0093_mwe_classification_governance.sql: constraint:employee_mwe_classifications_no_approved_overlap
DO $$
BEGIN
  ALTER TABLE employee_mwe_classifications
    ADD CONSTRAINT employee_mwe_classifications_no_approved_overlap
    EXCLUDE USING gist (
      employee_id WITH =,
      daterange(effective_from, COALESCE(effective_until, 'infinity'::date), '[]') WITH &&
    )
    WHERE (status = 'approved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- 0093_workforce_attrition_backfill.sql: constraint:workforce_scenarios_annual_attrition_check
ALTER TABLE "workforce_planning_scenarios"
  ADD CONSTRAINT "workforce_scenarios_annual_attrition_check"
  CHECK ("annual_attrition_percent" >= 0 AND "annual_attrition_percent" <= 100);

-- 0093_workforce_attrition_backfill.sql: constraint:workforce_scenarios_attrition_backfill_check
ALTER TABLE "workforce_planning_scenarios"
  ADD CONSTRAINT "workforce_scenarios_attrition_backfill_check"
  CHECK ("attrition_backfill_percent" >= 0 AND "attrition_backfill_percent" <= 100);

-- 0104_hcm_work_item_sla.sql: index:automation_cases_sla_due_idx
CREATE INDEX IF NOT EXISTS automation_cases_sla_due_idx
  ON automation_operational_cases (organization_id, sla_due_at)
  WHERE status <> 'resolved' AND sla_due_at IS NOT NULL;

-- 0104_hcm_work_item_sla.sql: index:automation_cases_owner_idx
CREATE INDEX IF NOT EXISTS automation_cases_owner_idx
  ON automation_operational_cases (organization_id, assigned_owner_user_id, status);

-- 0115_payout_profiles_foundation.sql: function:validate_payout_profile_tenant_scope
CREATE OR REPLACE FUNCTION validate_payout_profile_tenant_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM le.id FROM public.legal_entities le
    WHERE le.id = NEW.legal_entity_id
      AND le.organization_id = NEW.organization_id
    FOR SHARE OF le;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_PROFILE_TENANT_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- 0115_payout_profiles_foundation.sql: trigger:payout_profile_tenant_guard
CREATE TRIGGER payout_profile_tenant_guard
  BEFORE INSERT OR UPDATE OF organization_id, legal_entity_id
  ON public.payout_profiles FOR EACH ROW
  EXECUTE FUNCTION validate_payout_profile_tenant_scope();

-- 0116_payout_ledger_foundation.sql: function:protect_payout_transfer_identity
CREATE OR REPLACE FUNCTION protect_payout_transfer_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.payroll_entry_id IS DISTINCT FROM OLD.payroll_entry_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
  THEN
    RAISE EXCEPTION 'PAYOUT_IMMUTABLE_TRANSFER_IDENTITY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 0116_payout_ledger_foundation.sql: function:protect_payout_batch_identity
CREATE OR REPLACE FUNCTION protect_payout_batch_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.transfer_count IS DISTINCT FROM OLD.transfer_count
     OR NEW.total_amount_cents IS DISTINCT FROM OLD.total_amount_cents
  THEN
    RAISE EXCEPTION 'PAYOUT_IMMUTABLE_BATCH_IDENTITY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 0116_payout_ledger_foundation.sql: function:validate_payout_batch_scope
CREATE OR REPLACE FUNCTION validate_payout_batch_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM r.id FROM public.payroll_runs r
    WHERE r.id = NEW.payroll_run_id AND r.organization_id = NEW.organization_id
    FOR SHARE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_BATCH_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 0116_payout_ledger_foundation.sql: function:validate_payout_transfer_scope
CREATE OR REPLACE FUNCTION validate_payout_transfer_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pe.id FROM public.payroll_entries pe
    JOIN public.payroll_runs r ON r.id = pe.payroll_run_id
    JOIN public.employees e ON e.id = pe.employee_id
  WHERE r.id = NEW.payroll_run_id
    AND pe.id = NEW.payroll_entry_id
    AND e.id = NEW.employee_id
    AND r.organization_id = NEW.organization_id
    AND e.organization_id = NEW.organization_id
  FOR SHARE OF pe, r, e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_TRANSFER_TENANT_OR_ENTRY_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 0116_payout_ledger_foundation.sql: function:validate_payout_batch_transfer_scope
CREATE OR REPLACE FUNCTION validate_payout_batch_transfer_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM b.id FROM public.payout_batches b
    JOIN public.payout_transfers t
      ON t.payroll_run_id = b.payroll_run_id
      AND t.organization_id = b.organization_id
  WHERE b.id = NEW.payout_batch_id
    AND t.id = NEW.payout_transfer_id
    AND b.organization_id = NEW.organization_id
  FOR SHARE OF b, t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_BATCH_TRANSFER_SCOPE_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 0116_payout_ledger_foundation.sql: trigger:payout_transfer_identity_guard
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'payout_transfers'::regclass
                 AND tgname = 'payout_transfer_identity_guard') THEN
    CREATE TRIGGER payout_transfer_identity_guard
      BEFORE UPDATE ON payout_transfers FOR EACH ROW
      EXECUTE FUNCTION protect_payout_transfer_identity();
  END IF;
END $$;

-- 0116_payout_ledger_foundation.sql: trigger:payout_batch_identity_guard
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'payout_batches'::regclass
                 AND tgname = 'payout_batch_identity_guard') THEN
    CREATE TRIGGER payout_batch_identity_guard
      BEFORE UPDATE ON payout_batches FOR EACH ROW
      EXECUTE FUNCTION protect_payout_batch_identity();
  END IF;
END $$;

-- 0116_payout_ledger_foundation.sql: trigger:payout_batch_tenant_guard
CREATE TRIGGER payout_batch_tenant_guard
  BEFORE INSERT OR UPDATE OF organization_id, payroll_run_id
  ON payout_batches FOR EACH ROW EXECUTE FUNCTION validate_payout_batch_scope();

-- 0116_payout_ledger_foundation.sql: trigger:payout_transfer_tenant_guard
CREATE TRIGGER payout_transfer_tenant_guard
  BEFORE INSERT OR UPDATE OF organization_id, payroll_run_id, payroll_entry_id, employee_id
  ON payout_transfers FOR EACH ROW EXECUTE FUNCTION validate_payout_transfer_scope();

-- 0116_payout_ledger_foundation.sql: trigger:payout_batch_transfer_tenant_guard
CREATE TRIGGER payout_batch_transfer_tenant_guard
  BEFORE INSERT OR UPDATE OF organization_id, payout_batch_id, payout_transfer_id
  ON payout_batch_transfers FOR EACH ROW EXECUTE FUNCTION validate_payout_batch_transfer_scope();

-- 0118_wfm_roster_scale_rules.sql: index:wfm_schedule_assignment_effective_window_idx
CREATE INDEX IF NOT EXISTS wfm_schedule_assignment_effective_window_idx
  ON employee_schedule_assignments (organization_id, employee_id, effective_from, effective_until);

-- 0118_wfm_roster_scale_rules.sql: index:wfm_worksite_assignment_effective_window_idx
CREATE INDEX IF NOT EXISTS wfm_worksite_assignment_effective_window_idx
  ON employee_worksite_assignments (organization_id, employee_id, effective_from, effective_until);

-- 0120_wfm_punch_evidence.sql: function:validate_wfm_punch_tenant_scope
CREATE OR REPLACE FUNCTION validate_wfm_punch_tenant_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'worksite_punch_policies' THEN
    PERFORM 1 FROM worksites w
      WHERE w.id = NEW.worksite_id AND w.organization_id = NEW.organization_id
      FOR SHARE;
  ELSE
    PERFORM 1 FROM employees e
      WHERE e.id = NEW.employee_id AND e.organization_id = NEW.organization_id
      FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WFM_PUNCH_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'workforce_punch_submissions' THEN
    IF NEW.worksite_id IS NOT NULL THEN
      PERFORM 1 FROM worksites w
        WHERE w.id = NEW.worksite_id AND w.organization_id = NEW.organization_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_WORKSITE_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.photo_evidence_id IS NOT NULL THEN
      PERFORM 1 FROM workforce_punch_photo_evidence p
        WHERE p.id = NEW.photo_evidence_id
          AND p.organization_id = NEW.organization_id
          AND p.employee_id = NEW.employee_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_PHOTO_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.time_punch_id IS NOT NULL THEN
      PERFORM 1 FROM time_punches t
        WHERE t.id = NEW.time_punch_id
          AND t.organization_id = NEW.organization_id
          AND t.employee_id = NEW.employee_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_TIMECARD_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'WFM_PUNCH_REQUIRES_INDEPENDENT_REVIEW' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'pending' AND (
      NEW.reviewed_by_user_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
      OR NEW.time_punch_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'WFM_PUNCH_PENDING_CANNOT_ENTER_ATTENDANCE' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('approved', 'rejected') AND (
      NEW.reviewed_by_user_id IS NULL OR NEW.reviewed_at IS NULL
      OR NEW.reviewed_by_user_id = NEW.requested_by_user_id
      OR length(trim(coalesce(NEW.review_note, ''))) < 10
    ) THEN
      RAISE EXCEPTION 'WFM_PUNCH_REQUIRES_DISTINCT_HUMAN_CHECKER' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'WFM_PUNCH_REVIEW_DECISION_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 0120_wfm_punch_evidence.sql: trigger:wfm_worksite_policy_tenant_guard
CREATE OR REPLACE TRIGGER wfm_worksite_policy_tenant_guard
  BEFORE INSERT OR UPDATE ON worksite_punch_policies
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();

-- 0120_wfm_punch_evidence.sql: trigger:wfm_punch_consent_tenant_guard
CREATE OR REPLACE TRIGGER wfm_punch_consent_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_photo_consents
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();

-- 0120_wfm_punch_evidence.sql: trigger:wfm_punch_photo_tenant_guard
CREATE OR REPLACE TRIGGER wfm_punch_photo_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_photo_evidence
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();

-- 0120_wfm_punch_evidence.sql: trigger:wfm_punch_submission_tenant_guard
CREATE OR REPLACE TRIGGER wfm_punch_submission_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();

-- 0121_multi_entity_v2_scope_transfer.sql: column:registered_address
ALTER TABLE legal_entities ADD COLUMN IF NOT EXISTS registered_address text;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE payroll_jobs ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE payout_transfers ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE bank_file_validations ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE historical_payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE year_end_adjustments ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: column:legal_entity_id
ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- 0121_multi_entity_v2_scope_transfer.sql: constraint:user_entity_grants_tenant_entity_fk, constraint:user_entity_pref_tenant_entity_fk
DO $checks$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_grants_tenant_entity_fk') THEN
   ALTER TABLE user_legal_entity_grants ADD CONSTRAINT user_entity_grants_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_pref_tenant_entity_fk') THEN
   ALTER TABLE user_entity_preferences ADD CONSTRAINT user_entity_pref_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignment_tenant_entity_fk') THEN
   ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_from_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_from_tenant_entity_fk
     FOREIGN KEY (organization_id, from_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_to_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_to_tenant_entity_fk
     FOREIGN KEY (organization_id, to_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
END $checks$;

-- 0122_tenant_module_disclosure.sql: column:module_navigation_mode
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS module_navigation_mode varchar(8) NOT NULL DEFAULT 'all';

-- 0122_tenant_module_disclosure.sql: column:enabled_modules
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]';

-- 0123_multi_entity_forward_schema_repair.sql: index:employee_org_id_for_entity_scope
CREATE UNIQUE INDEX IF NOT EXISTS employee_org_id_for_entity_scope ON employees(organization_id,id);

-- 0123_multi_entity_forward_schema_repair.sql: index:user_org_id_for_entity_scope
CREATE UNIQUE INDEX IF NOT EXISTS user_org_id_for_entity_scope ON user_organizations(organization_id,user_id);

-- 0123_multi_entity_forward_schema_repair.sql: index:payroll_run_employer_identity_unique
CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_employer_identity_unique ON payroll_runs(id,legal_entity_id);

-- 0123_multi_entity_forward_schema_repair.sql: index:payroll_entry_employer_identity_unique
CREATE UNIQUE INDEX IF NOT EXISTS payroll_entry_employer_identity_unique ON payroll_entries(id,legal_entity_id);

-- 0123_multi_entity_forward_schema_repair.sql: constraint:employees_tenant_employer_fk, constraint:payroll_runs_tenant_employer_fk, constraint:entity_grant_membership_tenant_fk, constraint:entity_preference_membership_tenant_fk, constraint:payroll_entries_run_employer_fk, constraint:payslips_entry_employer_fk, constraint:payroll_jobs_run_employer_fk, constraint:payout_batches_run_employer_fk, constraint:payout_transfers_run_employer_fk, constraint:bank_file_validations_run_employer_fk, constraint:year_end_adjustments_run_employer_fk
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

-- Unnamed column-level CHECK constraints. Migrations declared these inline
-- without a name, so a source-first baseline lacks them. Each uses the name
-- PostgreSQL generates for an unnamed CHECK on that table and column.

-- 0053_hcm_capability_wfm_eligibility.sql: constraint:hcm_job_profile_skill_requirements_minimum_proficiency_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_job_profile_skill_requirements" ADD CONSTRAINT "hcm_job_profile_skill_requirements_minimum_proficiency_check" CHECK ("minimum_proficiency" BETWEEN 1 AND 5);

-- 0053_hcm_capability_wfm_eligibility.sql: constraint:hcm_employee_skills_proficiency_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employee_skills" ADD CONSTRAINT "hcm_employee_skills_proficiency_check" CHECK ("proficiency" BETWEEN 1 AND 5);

-- 0053_hcm_capability_wfm_eligibility.sql: constraint:hcm_employee_skills_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employee_skills" ADD CONSTRAINT "hcm_employee_skills_status_check" CHECK ("status" IN ('declared','verified','revoked'));

-- 0055_hcm_worksite_arrangements.sql: constraint:hcm_work_arrangements_mode_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_work_arrangements" ADD CONSTRAINT "hcm_work_arrangements_mode_check" CHECK ("mode" IN ('onsite','hybrid','remote','field'));

-- 0056_hcm_employment_terms.sql: constraint:hcm_employment_terms_term_kind_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_terms" ADD CONSTRAINT "hcm_employment_terms_term_kind_check" CHECK ("term_kind" IN ('regular','probationary','fixed_term','project','seasonal','casual','other'));

-- 0056_hcm_employment_terms.sql: constraint:hcm_employment_terms_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_terms" ADD CONSTRAINT "hcm_employment_terms_status_check" CHECK ("status" IN ('pending_approval','scheduled','active','superseded','cancelled','failed'));

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decisions_decision_kind_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decisions_decision_kind_check" CHECK ("decision_kind" IN ('confirm_regular','renew_term','extend_term','convert_terms','non_renew','continue_current'));

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decisions_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decisions_status_check" CHECK ("status" IN ('pending_approval','scheduled','applied','cancelled','failed'));

-- 0057_hcm_employment_term_decisions.sql: constraint:hcm_employment_term_decisions_separation_handoff_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_term_decisions" ADD CONSTRAINT "hcm_employment_term_decisions_separation_handoff_status_check" CHECK ("separation_handoff_status" IN ('none','ready','started','completed'));

-- 0060_hcm_lifecycle_notifications.sql: constraint:hcm_lifecycle_notification_tasks_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_lifecycle_notification_tasks" ADD CONSTRAINT "hcm_lifecycle_notification_tasks_status_check" CHECK ("status" IN ('open','acknowledged','snoozed','resolved'));

-- 0061_hcm_precise_leave_intervals.sql: constraint:leave_request_interval_sets_status_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "leave_request_interval_sets" ADD CONSTRAINT "leave_request_interval_sets_status_check" CHECK ("status" IN ('current','superseded'));

-- 0061_hcm_precise_leave_intervals.sql: constraint:leave_request_intervals_kind_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "leave_request_intervals" ADD CONSTRAINT "leave_request_intervals_kind_check" CHECK ("kind" IN ('full_day','first_half','second_half','timed'));

-- 0062_hcm_employment_decision_evidence.sql: constraint:hcm_employment_decision_notes_note_kind_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_decision_notes" ADD CONSTRAINT "hcm_employment_decision_notes_note_kind_check" CHECK ("note_kind" IN ('manager_review','hr_review','decision_rationale','other'));

-- 0062_hcm_employment_decision_evidence.sql: constraint:hcm_employment_decision_documents_evidence_kind_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_decision_documents" ADD CONSTRAINT "hcm_employment_decision_documents_evidence_kind_check" CHECK ("evidence_kind" IN ('probation_evaluation','performance_review','contract','manager_recommendation','other'));

-- 0063_hcm_lifecycle_policy.sql: constraint:hcm_lifecycle_policies_version_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_lifecycle_policies" ADD CONSTRAINT "hcm_lifecycle_policies_version_check" CHECK ("version" >= 1);

-- 0063_hcm_lifecycle_policy.sql: constraint:hcm_lifecycle_policies_action_window_days_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_lifecycle_policies" ADD CONSTRAINT "hcm_lifecycle_policies_action_window_days_check" CHECK ("action_window_days" BETWEEN 7 AND 90);

-- 0063_hcm_lifecycle_policy.sql: constraint:hcm_lifecycle_policies_reminder_days_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_lifecycle_policies" ADD CONSTRAINT "hcm_lifecycle_policies_reminder_days_check" CHECK (jsonb_typeof("reminder_days") = 'array');

-- 0063_hcm_lifecycle_policy.sql: constraint:hcm_lifecycle_policies_overdue_escalation_days_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_lifecycle_policies" ADD CONSTRAINT "hcm_lifecycle_policies_overdue_escalation_days_check" CHECK (jsonb_typeof("overdue_escalation_days") = 'array');

-- 0065_hcm_manager_attestation.sql: constraint:hcm_employment_decision_manager_attestatio_recommendation_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "hcm_employment_decision_manager_attestations" ADD CONSTRAINT "hcm_employment_decision_manager_attestatio_recommendation_check" CHECK ("recommendation" IN ('support','do_not_support','needs_more_review'));

-- 0106_saas_selfserve_recurring_billing.sql: constraint:saas_billing_checkouts_seats_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "saas_billing_checkouts" ADD CONSTRAINT "saas_billing_checkouts_seats_check" CHECK (seats BETWEEN 1 AND 2000);

-- 0106_saas_selfserve_recurring_billing.sql: constraint:saas_billing_checkouts_amount_cents_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "saas_billing_checkouts" ADD CONSTRAINT "saas_billing_checkouts_amount_cents_check" CHECK (amount_cents > 0);

-- 0106_saas_selfserve_recurring_billing.sql: constraint:saas_billing_checkouts_currency_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "saas_billing_checkouts" ADD CONSTRAINT "saas_billing_checkouts_currency_check" CHECK (currency='PHP');

-- 0117_inline_first_payroll_journey.sql: constraint:first_payroll_journey_progress_step_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "first_payroll_journey_progress" ADD CONSTRAINT "first_payroll_journey_progress_step_check" CHECK (step IN ('company','people','time','reviewers','payroll','approval','exports'));

-- 0117_inline_first_payroll_journey.sql: constraint:first_payroll_journey_progress_owner_role_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "first_payroll_journey_progress" ADD CONSTRAINT "first_payroll_journey_progress_owner_role_check" CHECK (owner_role IN ('owner','hr','payroll','checker','bookkeeper'));

-- 0120_wfm_punch_evidence.sql: constraint:workforce_punch_submissions_flags_check (unnamed column CHECK in the source; PostgreSQL-generated name)
ALTER TABLE "workforce_punch_submissions" ADD CONSTRAINT "workforce_punch_submissions_flags_check" CHECK (jsonb_typeof(flags) = 'array');

-- 0134_wfm_demand_missing_foundation_forward.sql: source-first baseline parity.
-- The six demand tables are created by Drizzle schema push, but these five
-- composite UNIQUE indexes and nine employer-bound FKs are migration-only.
-- Exactly copy the 0134 definitions into an isolated, empty source baseline.
-- Not permission to apply SQL on Neon or a serving application database.
-- Ensure the real worksite/job-profile parent pairs are FK-eligible. PK
-- identity alone is not a sufficient UNIQUE reference for a composite FK.
-- These indexes may lock existing parents; the 3s timeout fails closed.
CREATE UNIQUE INDEX wfm_demand_worksites_org_id_fk_unique
  ON public.worksites(organization_id, id);
CREATE UNIQUE INDEX wfm_demand_job_profiles_org_id_fk_unique
  ON public.job_profiles(organization_id, id);

-- Additional tenant-integrity FKs, intentionally stricter than the
-- historical single-column ID references above. No server-side permission
-- is broadened; reject cross-organization reference IDs at the DB layer.
CREATE UNIQUE INDEX wfm_demand_import_org_worksite_id_fk_unique
  ON public.workforce_demand_import_batches(organization_id,worksite_id,id);
CREATE UNIQUE INDEX wfm_demand_issued_org_id_fk_unique
  ON public.workforce_demand_forecast_issues(organization_id,id);
CREATE UNIQUE INDEX wfm_demand_policy_org_id_fk_unique
  ON public.workforce_demand_staffing_policies(organization_id,id);

ALTER TABLE public.workforce_demand_import_batches
  ADD CONSTRAINT wfm_demand_import_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE;
ALTER TABLE public.workforce_demand_observation_revisions
  ADD CONSTRAINT wfm_demand_revision_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT wfm_demand_revision_batch_tenant_fk
  FOREIGN KEY(organization_id,worksite_id,import_batch_id)
  REFERENCES public.workforce_demand_import_batches(organization_id,worksite_id,id)
  ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_forecast_issues
  ADD CONSTRAINT wfm_demand_issued_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE;
ALTER TABLE public.workforce_demand_forecast_scores
  ADD CONSTRAINT wfm_demand_score_issue_tenant_fk
  FOREIGN KEY(organization_id,issue_id)
  REFERENCES public.workforce_demand_forecast_issues(organization_id,id)
  ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_staffing_policies
  ADD CONSTRAINT wfm_demand_policy_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT wfm_demand_policy_job_tenant_fk
  FOREIGN KEY(organization_id,job_profile_id)
  REFERENCES public.job_profiles(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_staffing_policy_events
  ADD CONSTRAINT wfm_demand_event_policy_tenant_fk
  FOREIGN KEY(organization_id,policy_id)
  REFERENCES public.workforce_demand_staffing_policies(organization_id,id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT wfm_demand_event_prior_policy_tenant_fk
  FOREIGN KEY(organization_id,prior_policy_id)
  REFERENCES public.workforce_demand_staffing_policies(organization_id,id)
  ON DELETE RESTRICT;
