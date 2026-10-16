-- #1015 / #1054 / #1061: post-0126 FK naming reconciliation (source-only).
-- Forward-only ADDITIVE catalog change. This file is NOT a production approval.
-- The historical 0124/0125/0126 sources are immutable and must not be edited.
-- Requires independently approved 0127 history and all 49 FKs to exist, valid,
-- with the expected single-column reference and ON DELETE/UPDATE contract.
-- PostgreSQL identifiers longer than 63 bytes use PG's exact 63-byte truncation.
-- No DML, grant, historical replay or mutation of FK semantics is permitted.
DO $issue1121_fk_preflight$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
    ('attendance_exception_events', 'attendance_exception_events_employee_id_fkey', 'attendance_exception_events_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('attendance_exception_events', 'attendance_exception_events_organization_id_fkey', 'attendance_exception_events_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('attendance_exception_events', 'attendance_exception_events_owner_user_id_fkey', 'attendance_exception_events_owner_user_id_users_id_fk', 'owner_user_id', 'users', 'id', 'n', 'a'),
    ('attendance_exception_events', 'attendance_exception_events_punch_id_fkey', 'attendance_exception_events_punch_id_time_punches_id_fk', 'punch_id', 'time_punches', 'id', 'n', 'a'),
    ('attendance_exception_events', 'attendance_exception_events_resolved_by_user_id_fkey', 'attendance_exception_events_resolved_by_user_id_users_id_fk', 'resolved_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_bands', 'compensation_bands_created_by_user_id_fkey', 'compensation_bands_created_by_user_id_users_id_fk', 'created_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_bands', 'compensation_bands_grade_id_fkey', 'compensation_bands_grade_id_job_grades_id_fk', 'grade_id', 'job_grades', 'id', 'r', 'a'),
    ('compensation_bands', 'compensation_bands_job_profile_id_fkey', 'compensation_bands_job_profile_id_job_profiles_id_fk', 'job_profile_id', 'job_profiles', 'id', 'r', 'a'),
    ('compensation_bands', 'compensation_bands_legal_entity_id_fkey', 'compensation_bands_legal_entity_id_legal_entities_id_fk', 'legal_entity_id', 'legal_entities', 'id', 'r', 'a'),
    ('compensation_bands', 'compensation_bands_organization_id_fkey', 'compensation_bands_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('compensation_components', 'compensation_components_created_by_user_id_fkey', 'compensation_components_created_by_user_id_users_id_fk', 'created_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_components', 'compensation_components_organization_id_fkey', 'compensation_components_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('compensation_cycles', 'compensation_cycles_created_by_user_id_fkey', 'compensation_cycles_created_by_user_id_users_id_fk', 'created_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_cycles', 'compensation_cycles_organization_id_fkey', 'compensation_cycles_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('compensation_events', 'compensation_events_actor_user_id_fkey', 'compensation_events_actor_user_id_users_id_fk', 'actor_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_events', 'compensation_events_band_id_fkey', 'compensation_events_band_id_compensation_bands_id_fk', 'band_id', 'compensation_bands', 'id', 'n', 'a'),
    ('compensation_events', 'compensation_events_component_assignment_id_fkey', 'compensation_events_component_assignment_id_employee_compensati', 'component_assignment_id', 'employee_compensation_components', 'id', 'n', 'a'),
    ('compensation_events', 'compensation_events_employee_id_fkey', 'compensation_events_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('compensation_events', 'compensation_events_organization_id_fkey', 'compensation_events_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('compensation_events', 'compensation_events_pay_revision_id_fkey', 'compensation_events_pay_revision_id_employee_pay_revisions_id_f', 'pay_revision_id', 'employee_pay_revisions', 'id', 'n', 'a'),
    ('compensation_events', 'compensation_events_proposal_id_fkey', 'compensation_events_proposal_id_compensation_proposals_id_fk', 'proposal_id', 'compensation_proposals', 'id', 'n', 'a'),
    ('compensation_proposals', 'compensation_proposals_applied_pay_revision_id_fkey', 'compensation_proposals_applied_pay_revision_id_employee_pay_rev', 'applied_pay_revision_id', 'employee_pay_revisions', 'id', 'n', 'a'),
    ('compensation_proposals', 'compensation_proposals_approved_by_user_id_fkey', 'compensation_proposals_approved_by_user_id_users_id_fk', 'approved_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_proposals', 'compensation_proposals_band_id_fkey', 'compensation_proposals_band_id_compensation_bands_id_fk', 'band_id', 'compensation_bands', 'id', 'r', 'a'),
    ('compensation_proposals', 'compensation_proposals_cycle_id_fkey', 'compensation_proposals_cycle_id_compensation_cycles_id_fk', 'cycle_id', 'compensation_cycles', 'id', 'c', 'a'),
    ('compensation_proposals', 'compensation_proposals_employee_id_fkey', 'compensation_proposals_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('compensation_proposals', 'compensation_proposals_organization_id_fkey', 'compensation_proposals_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('compensation_proposals', 'compensation_proposals_submitted_by_user_id_fkey', 'compensation_proposals_submitted_by_user_id_users_id_fk', 'submitted_by_user_id', 'users', 'id', 'n', 'a'),
    ('compensation_proposals', 'compensation_proposals_worker_effective_change_id_fkey', 'compensation_proposals_worker_effective_change_id_worker_effect', 'worker_effective_change_id', 'worker_effective_changes', 'id', 'n', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_approved_by_user_id_fkey', 'employee_compensation_components_approved_by_user_id_users_id_f', 'approved_by_user_id', 'users', 'id', 'n', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_cancelled_by_user_id_fkey', 'employee_compensation_components_cancelled_by_user_id_users_id_', 'cancelled_by_user_id', 'users', 'id', 'n', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_component_id_fkey', 'employee_compensation_components_component_id_compensation_comp', 'component_id', 'compensation_components', 'id', 'r', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_employee_id_fkey', 'employee_compensation_components_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_organization_id_fkey', 'employee_compensation_components_organization_id_organizations_', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('employee_compensation_components', 'employee_compensation_components_requested_by_user_id_fkey', 'employee_compensation_components_requested_by_user_id_users_id_', 'requested_by_user_id', 'users', 'id', 'n', 'a'),
    ('employee_availability_rules', 'employee_availability_rules_created_by_user_id_fkey', 'employee_availability_rules_created_by_user_id_users_id_fk', 'created_by_user_id', 'users', 'id', 'n', 'a'),
    ('employee_availability_rules', 'employee_availability_rules_employee_id_fkey', 'employee_availability_rules_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('employee_availability_rules', 'employee_availability_rules_organization_id_fkey', 'employee_availability_rules_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('open_shift_claims', 'open_shift_claims_decided_by_user_id_fkey', 'open_shift_claims_decided_by_user_id_users_id_fk', 'decided_by_user_id', 'users', 'id', 'n', 'a'),
    ('open_shift_claims', 'open_shift_claims_employee_id_fkey', 'open_shift_claims_employee_id_employees_id_fk', 'employee_id', 'employees', 'id', 'c', 'a'),
    ('open_shift_claims', 'open_shift_claims_open_shift_id_fkey', 'open_shift_claims_open_shift_id_open_shifts_id_fk', 'open_shift_id', 'open_shifts', 'id', 'c', 'a'),
    ('open_shift_claims', 'open_shift_claims_organization_id_fkey', 'open_shift_claims_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('open_shift_claims', 'open_shift_claims_requested_by_user_id_fkey', 'open_shift_claims_requested_by_user_id_users_id_fk', 'requested_by_user_id', 'users', 'id', 'n', 'a'),
    ('open_shifts', 'open_shifts_created_by_user_id_fkey', 'open_shifts_created_by_user_id_users_id_fk', 'created_by_user_id', 'users', 'id', 'n', 'a'),
    ('open_shifts', 'open_shifts_job_profile_id_fkey', 'open_shifts_job_profile_id_job_profiles_id_fk', 'job_profile_id', 'job_profiles', 'id', 'r', 'a'),
    ('open_shifts', 'open_shifts_organization_id_fkey', 'open_shifts_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'id', 'c', 'a'),
    ('open_shifts', 'open_shifts_shift_definition_id_fkey', 'open_shifts_shift_definition_id_shift_definitions_id_fk', 'shift_definition_id', 'shift_definitions', 'id', 'r', 'a'),
    ('open_shifts', 'open_shifts_source_requirement_id_fkey', 'open_shifts_source_requirement_id_staffing_requirements_id_fk', 'source_requirement_id', 'staffing_requirements', 'id', 'n', 'a'),
    ('open_shifts', 'open_shifts_worksite_id_fkey', 'open_shifts_worksite_id_worksites_id_fk', 'worksite_id', 'worksites', 'id', 'c', 'a')
    ) AS expected(table_name, old_name, new_name, column_name, ref_table, ref_column, delete_code, update_code)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_class own ON own.oid = k.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = own.relnamespace
      WHERE ns.nspname = 'public' AND own.relname = item.table_name
        AND k.conname = item.new_name
    ) THEN
      RAISE EXCEPTION 'ISSUE1121_TARGET_FK_NAME_ALREADY_PRESENT: %.%', item.table_name, item.new_name
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_class own ON own.oid = k.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = own.relnamespace
      JOIN pg_catalog.pg_class parent ON parent.oid = k.confrelid
      JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
      JOIN pg_catalog.pg_attribute local_att
        ON local_att.attrelid = own.oid AND local_att.attname = item.column_name
        AND local_att.attnum > 0 AND NOT local_att.attisdropped
      JOIN pg_catalog.pg_attribute ref_att
        ON ref_att.attrelid = parent.oid AND ref_att.attname = item.ref_column
        AND ref_att.attnum > 0 AND NOT ref_att.attisdropped
      WHERE ns.nspname = 'public' AND pn.nspname = 'public'
        AND own.relname = item.table_name AND parent.relname = item.ref_table
        AND own.relkind IN ('r','p') AND parent.relkind IN ('r','p')
        AND k.contype = 'f' AND k.conname = item.old_name
        AND k.conkey = ARRAY[local_att.attnum]::smallint[]
        AND k.confkey = ARRAY[ref_att.attnum]::smallint[]
        AND k.confdeltype = item.delete_code::"char"
        AND k.confupdtype = item.update_code::"char"
        AND k.confmatchtype = 's'
        AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
    ) THEN
      RAISE EXCEPTION 'ISSUE1121_FK_IDENTITY_OR_POLICY_DRIFT: %.%', item.table_name, item.old_name
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $issue1121_fk_preflight$;

ALTER TABLE public."attendance_exception_events" RENAME CONSTRAINT "attendance_exception_events_employee_id_fkey" TO "attendance_exception_events_employee_id_employees_id_fk";
ALTER TABLE public."attendance_exception_events" RENAME CONSTRAINT "attendance_exception_events_organization_id_fkey" TO "attendance_exception_events_organization_id_organizations_id_fk";
ALTER TABLE public."attendance_exception_events" RENAME CONSTRAINT "attendance_exception_events_owner_user_id_fkey" TO "attendance_exception_events_owner_user_id_users_id_fk";
ALTER TABLE public."attendance_exception_events" RENAME CONSTRAINT "attendance_exception_events_punch_id_fkey" TO "attendance_exception_events_punch_id_time_punches_id_fk";
ALTER TABLE public."attendance_exception_events" RENAME CONSTRAINT "attendance_exception_events_resolved_by_user_id_fkey" TO "attendance_exception_events_resolved_by_user_id_users_id_fk";
ALTER TABLE public."compensation_bands" RENAME CONSTRAINT "compensation_bands_created_by_user_id_fkey" TO "compensation_bands_created_by_user_id_users_id_fk";
ALTER TABLE public."compensation_bands" RENAME CONSTRAINT "compensation_bands_grade_id_fkey" TO "compensation_bands_grade_id_job_grades_id_fk";
ALTER TABLE public."compensation_bands" RENAME CONSTRAINT "compensation_bands_job_profile_id_fkey" TO "compensation_bands_job_profile_id_job_profiles_id_fk";
ALTER TABLE public."compensation_bands" RENAME CONSTRAINT "compensation_bands_legal_entity_id_fkey" TO "compensation_bands_legal_entity_id_legal_entities_id_fk";
ALTER TABLE public."compensation_bands" RENAME CONSTRAINT "compensation_bands_organization_id_fkey" TO "compensation_bands_organization_id_organizations_id_fk";
ALTER TABLE public."compensation_components" RENAME CONSTRAINT "compensation_components_created_by_user_id_fkey" TO "compensation_components_created_by_user_id_users_id_fk";
ALTER TABLE public."compensation_components" RENAME CONSTRAINT "compensation_components_organization_id_fkey" TO "compensation_components_organization_id_organizations_id_fk";
ALTER TABLE public."compensation_cycles" RENAME CONSTRAINT "compensation_cycles_created_by_user_id_fkey" TO "compensation_cycles_created_by_user_id_users_id_fk";
ALTER TABLE public."compensation_cycles" RENAME CONSTRAINT "compensation_cycles_organization_id_fkey" TO "compensation_cycles_organization_id_organizations_id_fk";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_actor_user_id_fkey" TO "compensation_events_actor_user_id_users_id_fk";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_band_id_fkey" TO "compensation_events_band_id_compensation_bands_id_fk";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_component_assignment_id_fkey" TO "compensation_events_component_assignment_id_employee_compensati";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_employee_id_fkey" TO "compensation_events_employee_id_employees_id_fk";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_organization_id_fkey" TO "compensation_events_organization_id_organizations_id_fk";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_pay_revision_id_fkey" TO "compensation_events_pay_revision_id_employee_pay_revisions_id_f";
ALTER TABLE public."compensation_events" RENAME CONSTRAINT "compensation_events_proposal_id_fkey" TO "compensation_events_proposal_id_compensation_proposals_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_applied_pay_revision_id_fkey" TO "compensation_proposals_applied_pay_revision_id_employee_pay_rev";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_approved_by_user_id_fkey" TO "compensation_proposals_approved_by_user_id_users_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_band_id_fkey" TO "compensation_proposals_band_id_compensation_bands_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_cycle_id_fkey" TO "compensation_proposals_cycle_id_compensation_cycles_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_employee_id_fkey" TO "compensation_proposals_employee_id_employees_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_organization_id_fkey" TO "compensation_proposals_organization_id_organizations_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_submitted_by_user_id_fkey" TO "compensation_proposals_submitted_by_user_id_users_id_fk";
ALTER TABLE public."compensation_proposals" RENAME CONSTRAINT "compensation_proposals_worker_effective_change_id_fkey" TO "compensation_proposals_worker_effective_change_id_worker_effect";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_approved_by_user_id_fkey" TO "employee_compensation_components_approved_by_user_id_users_id_f";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_cancelled_by_user_id_fkey" TO "employee_compensation_components_cancelled_by_user_id_users_id_";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_component_id_fkey" TO "employee_compensation_components_component_id_compensation_comp";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_employee_id_fkey" TO "employee_compensation_components_employee_id_employees_id_fk";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_organization_id_fkey" TO "employee_compensation_components_organization_id_organizations_";
ALTER TABLE public."employee_compensation_components" RENAME CONSTRAINT "employee_compensation_components_requested_by_user_id_fkey" TO "employee_compensation_components_requested_by_user_id_users_id_";

-- #1054 WFM counterparts: rename only after the same strict catalog guard.
ALTER TABLE public."employee_availability_rules" RENAME CONSTRAINT "employee_availability_rules_created_by_user_id_fkey" TO "employee_availability_rules_created_by_user_id_users_id_fk";
ALTER TABLE public."employee_availability_rules" RENAME CONSTRAINT "employee_availability_rules_employee_id_fkey" TO "employee_availability_rules_employee_id_employees_id_fk";
ALTER TABLE public."employee_availability_rules" RENAME CONSTRAINT "employee_availability_rules_organization_id_fkey" TO "employee_availability_rules_organization_id_organizations_id_fk";
ALTER TABLE public."open_shift_claims" RENAME CONSTRAINT "open_shift_claims_decided_by_user_id_fkey" TO "open_shift_claims_decided_by_user_id_users_id_fk";
ALTER TABLE public."open_shift_claims" RENAME CONSTRAINT "open_shift_claims_employee_id_fkey" TO "open_shift_claims_employee_id_employees_id_fk";
ALTER TABLE public."open_shift_claims" RENAME CONSTRAINT "open_shift_claims_open_shift_id_fkey" TO "open_shift_claims_open_shift_id_open_shifts_id_fk";
ALTER TABLE public."open_shift_claims" RENAME CONSTRAINT "open_shift_claims_organization_id_fkey" TO "open_shift_claims_organization_id_organizations_id_fk";
ALTER TABLE public."open_shift_claims" RENAME CONSTRAINT "open_shift_claims_requested_by_user_id_fkey" TO "open_shift_claims_requested_by_user_id_users_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_created_by_user_id_fkey" TO "open_shifts_created_by_user_id_users_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_job_profile_id_fkey" TO "open_shifts_job_profile_id_job_profiles_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_organization_id_fkey" TO "open_shifts_organization_id_organizations_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_shift_definition_id_fkey" TO "open_shifts_shift_definition_id_shift_definitions_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_source_requirement_id_fkey" TO "open_shifts_source_requirement_id_staffing_requirements_id_fk";
ALTER TABLE public."open_shifts" RENAME CONSTRAINT "open_shifts_worksite_id_fkey" TO "open_shifts_worksite_id_worksites_id_fk";
