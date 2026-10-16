-- #1127 follow-up: proposed 0129 source-only FK *name* reconciliation for
-- non-recovery 0115-0123 forward train catalog. NOT an approval or receipt.
-- MUST follow genuinely approved 0127 and the separately reviewed 0128,
-- and only after the protected runner's identity, backup, historical hashes,
-- permissions, tenant security and independently witnessed cutover gates.
-- ZERO DML, GRANT/REVOKE, deletion, validation or change of FK behavior.
-- A reviewed external runner owns ONE atomic transaction. STOP on any drift.
-- All 54 old/new name pairs were observed with matching *full* FK contracts
-- on disposable PG16 by #1127 at 5c630909cbaaec101f083528cb316c8bbf718a47.
-- Source manifests are not evidence of any real production database shape.
DO $issue_0129_preflight$
DECLARE
  item record;
  old_name text;
  target_name text;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
    ('employee_entity_assignments', 'employee_id', 'employees', 'r'),
    ('employee_entity_assignments', 'legal_entity_id', 'legal_entities', 'r'),
    ('employee_entity_assignments', 'organization_id', 'organizations', 'c'),
    ('entity_transfer_requests', 'approved_by_user_id', 'users', 'r'),
    ('entity_transfer_requests', 'employee_id', 'employees', 'r'),
    ('entity_transfer_requests', 'from_legal_entity_id', 'legal_entities', 'r'),
    ('entity_transfer_requests', 'organization_id', 'organizations', 'c'),
    ('entity_transfer_requests', 'requested_by_user_id', 'users', 'r'),
    ('entity_transfer_requests', 'to_legal_entity_id', 'legal_entities', 'r'),
    ('payout_batch_transfers', 'organization_id', 'organizations', 'r'),
    ('payout_batch_transfers', 'payout_batch_id', 'payout_batches', 'r'),
    ('payout_batch_transfers', 'payout_transfer_id', 'payout_transfers', 'r'),
    ('payout_batches', 'organization_id', 'organizations', 'r'),
    ('payout_batches', 'payroll_run_id', 'payroll_runs', 'r'),
    ('payout_profiles', 'bank_template_id', 'bank_templates', 'n'),
    ('payout_profiles', 'created_by_user_id', 'users', 'n'),
    ('payout_profiles', 'legal_entity_id', 'legal_entities', 'c'),
    ('payout_profiles', 'organization_id', 'organizations', 'c'),
    ('payout_profiles', 'updated_by_user_id', 'users', 'n'),
    ('payout_transfers', 'employee_id', 'employees', 'r'),
    ('payout_transfers', 'organization_id', 'organizations', 'r'),
    ('payout_transfers', 'payroll_entry_id', 'payroll_entries', 'r'),
    ('payout_transfers', 'payroll_run_id', 'payroll_runs', 'r'),
    ('provider_events', 'organization_id', 'organizations', 'c'),
    ('provider_events', 'payroll_run_id', 'payroll_runs', 'n'),
    ('user_entity_preferences', 'legal_entity_id', 'legal_entities', 'r'),
    ('user_entity_preferences', 'organization_id', 'organizations', 'c'),
    ('user_entity_preferences', 'user_id', 'users', 'c'),
    ('user_legal_entity_grants', 'granted_by_user_id', 'users', 'n'),
    ('user_legal_entity_grants', 'legal_entity_id', 'legal_entities', 'r'),
    ('user_legal_entity_grants', 'organization_id', 'organizations', 'c'),
    ('user_legal_entity_grants', 'user_id', 'users', 'c'),
    ('workforce_demand_forecast_issues', 'issued_by_user_id', 'users', 'n'),
    ('workforce_demand_forecast_issues', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_forecast_issues', 'worksite_id', 'worksites', 'c'),
    ('workforce_demand_forecast_scores', 'issue_id', 'workforce_demand_forecast_issues', 'r'),
    ('workforce_demand_forecast_scores', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_forecast_scores', 'scored_by_user_id', 'users', 'n'),
    ('workforce_demand_import_batches', 'created_by_user_id', 'users', 'n'),
    ('workforce_demand_import_batches', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_import_batches', 'worksite_id', 'worksites', 'c'),
    ('workforce_demand_observation_revisions', 'import_batch_id', 'workforce_demand_import_batches', 'r'),
    ('workforce_demand_observation_revisions', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_observation_revisions', 'worksite_id', 'worksites', 'c'),
    ('workforce_demand_staffing_policies', 'decided_by_user_id', 'users', 'n'),
    ('workforce_demand_staffing_policies', 'job_profile_id', 'job_profiles', 'r'),
    ('workforce_demand_staffing_policies', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_staffing_policies', 'proposed_by_user_id', 'users', 'r'),
    ('workforce_demand_staffing_policies', 'submitted_by_user_id', 'users', 'n'),
    ('workforce_demand_staffing_policies', 'worksite_id', 'worksites', 'r'),
    ('workforce_demand_staffing_policy_events', 'actor_user_id', 'users', 'r'),
    ('workforce_demand_staffing_policy_events', 'organization_id', 'organizations', 'c'),
    ('workforce_demand_staffing_policy_events', 'policy_id', 'workforce_demand_staffing_policies', 'r'),
    ('workforce_demand_staffing_policy_events', 'prior_policy_id', 'workforce_demand_staffing_policies', 'r')
    ) AS expected(child_table, child_column, parent_table, delete_code)
  LOOP
    old_name := left(item.child_table || '_' || item.child_column || '_fkey', 63);
    target_name := left(item.child_table || '_' || item.child_column || '_' ||
                        item.parent_table || '_id_fk', 63);
    IF old_name = target_name THEN
      RAISE EXCEPTION 'ISSUE0129_INVALID_TARGET_NAME: %.%', item.child_table, old_name
        USING ERRCODE = 'P0001';
    END IF;
    -- Never rename a swapped FK, an unvalidated constraint, a different
    -- parent/column mapping, or a target name already claimed by another FK.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint existing
      JOIN pg_catalog.pg_class t ON t.oid = existing.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = t.relnamespace
      WHERE ns.nspname = 'public' AND t.relname = item.child_table
        AND existing.conname = target_name
    ) THEN
      RAISE EXCEPTION 'ISSUE0129_TARGET_CONSTRAINT_NAME_EXISTS: %.%',
        item.child_table, target_name USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid
      JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      JOIN pg_catalog.pg_attribute src ON src.attrelid = child.oid
        AND src.attname = item.child_column
        AND src.attnum > 0 AND NOT src.attisdropped
      JOIN pg_catalog.pg_attribute dst ON dst.attrelid = parent.oid
        AND dst.attname = 'id' AND dst.attnum > 0 AND NOT dst.attisdropped
      WHERE child_ns.nspname = 'public' AND parent_ns.nspname = 'public'
        AND child.relkind IN ('r','p') AND parent.relkind IN ('r','p')
        AND child.relname = item.child_table
        AND parent.relname = item.parent_table
        AND fk.conname = old_name AND fk.contype = 'f'
        AND fk.conkey = ARRAY[src.attnum]::smallint[]
        AND fk.confkey = ARRAY[dst.attnum]::smallint[]
        AND fk.confdeltype = item.delete_code::"char"
        AND fk.confupdtype = 'a' AND fk.confmatchtype = 's'
        AND fk.convalidated AND NOT fk.condeferrable AND NOT fk.condeferred
    ) THEN
      RAISE EXCEPTION 'ISSUE0129_FK_CATALOG_CONTRACT_MISMATCH: %.%',
        item.child_table, old_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $issue_0129_preflight$;

-- 54 bare constraint renames. No DROP/ADD/VALIDATE or inferred data repair.
ALTER TABLE public."employee_entity_assignments" RENAME CONSTRAINT "employee_entity_assignments_employee_id_fkey" TO "employee_entity_assignments_employee_id_employees_id_fk";
ALTER TABLE public."employee_entity_assignments" RENAME CONSTRAINT "employee_entity_assignments_legal_entity_id_fkey" TO "employee_entity_assignments_legal_entity_id_legal_entities_id_f";
ALTER TABLE public."employee_entity_assignments" RENAME CONSTRAINT "employee_entity_assignments_organization_id_fkey" TO "employee_entity_assignments_organization_id_organizations_id_fk";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_approved_by_user_id_fkey" TO "entity_transfer_requests_approved_by_user_id_users_id_fk";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_employee_id_fkey" TO "entity_transfer_requests_employee_id_employees_id_fk";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_from_legal_entity_id_fkey" TO "entity_transfer_requests_from_legal_entity_id_legal_entities_id";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_organization_id_fkey" TO "entity_transfer_requests_organization_id_organizations_id_fk";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_requested_by_user_id_fkey" TO "entity_transfer_requests_requested_by_user_id_users_id_fk";
ALTER TABLE public."entity_transfer_requests" RENAME CONSTRAINT "entity_transfer_requests_to_legal_entity_id_fkey" TO "entity_transfer_requests_to_legal_entity_id_legal_entities_id_f";
ALTER TABLE public."payout_batch_transfers" RENAME CONSTRAINT "payout_batch_transfers_organization_id_fkey" TO "payout_batch_transfers_organization_id_organizations_id_fk";
ALTER TABLE public."payout_batch_transfers" RENAME CONSTRAINT "payout_batch_transfers_payout_batch_id_fkey" TO "payout_batch_transfers_payout_batch_id_payout_batches_id_fk";
ALTER TABLE public."payout_batch_transfers" RENAME CONSTRAINT "payout_batch_transfers_payout_transfer_id_fkey" TO "payout_batch_transfers_payout_transfer_id_payout_transfers_id_f";
ALTER TABLE public."payout_batches" RENAME CONSTRAINT "payout_batches_organization_id_fkey" TO "payout_batches_organization_id_organizations_id_fk";
ALTER TABLE public."payout_batches" RENAME CONSTRAINT "payout_batches_payroll_run_id_fkey" TO "payout_batches_payroll_run_id_payroll_runs_id_fk";
ALTER TABLE public."payout_profiles" RENAME CONSTRAINT "payout_profiles_bank_template_id_fkey" TO "payout_profiles_bank_template_id_bank_templates_id_fk";
ALTER TABLE public."payout_profiles" RENAME CONSTRAINT "payout_profiles_created_by_user_id_fkey" TO "payout_profiles_created_by_user_id_users_id_fk";
ALTER TABLE public."payout_profiles" RENAME CONSTRAINT "payout_profiles_legal_entity_id_fkey" TO "payout_profiles_legal_entity_id_legal_entities_id_fk";
ALTER TABLE public."payout_profiles" RENAME CONSTRAINT "payout_profiles_organization_id_fkey" TO "payout_profiles_organization_id_organizations_id_fk";
ALTER TABLE public."payout_profiles" RENAME CONSTRAINT "payout_profiles_updated_by_user_id_fkey" TO "payout_profiles_updated_by_user_id_users_id_fk";
ALTER TABLE public."payout_transfers" RENAME CONSTRAINT "payout_transfers_employee_id_fkey" TO "payout_transfers_employee_id_employees_id_fk";
ALTER TABLE public."payout_transfers" RENAME CONSTRAINT "payout_transfers_organization_id_fkey" TO "payout_transfers_organization_id_organizations_id_fk";
ALTER TABLE public."payout_transfers" RENAME CONSTRAINT "payout_transfers_payroll_entry_id_fkey" TO "payout_transfers_payroll_entry_id_payroll_entries_id_fk";
ALTER TABLE public."payout_transfers" RENAME CONSTRAINT "payout_transfers_payroll_run_id_fkey" TO "payout_transfers_payroll_run_id_payroll_runs_id_fk";
ALTER TABLE public."provider_events" RENAME CONSTRAINT "provider_events_organization_id_fkey" TO "provider_events_organization_id_organizations_id_fk";
ALTER TABLE public."provider_events" RENAME CONSTRAINT "provider_events_payroll_run_id_fkey" TO "provider_events_payroll_run_id_payroll_runs_id_fk";
ALTER TABLE public."user_entity_preferences" RENAME CONSTRAINT "user_entity_preferences_legal_entity_id_fkey" TO "user_entity_preferences_legal_entity_id_legal_entities_id_fk";
ALTER TABLE public."user_entity_preferences" RENAME CONSTRAINT "user_entity_preferences_organization_id_fkey" TO "user_entity_preferences_organization_id_organizations_id_fk";
ALTER TABLE public."user_entity_preferences" RENAME CONSTRAINT "user_entity_preferences_user_id_fkey" TO "user_entity_preferences_user_id_users_id_fk";
ALTER TABLE public."user_legal_entity_grants" RENAME CONSTRAINT "user_legal_entity_grants_granted_by_user_id_fkey" TO "user_legal_entity_grants_granted_by_user_id_users_id_fk";
ALTER TABLE public."user_legal_entity_grants" RENAME CONSTRAINT "user_legal_entity_grants_legal_entity_id_fkey" TO "user_legal_entity_grants_legal_entity_id_legal_entities_id_fk";
ALTER TABLE public."user_legal_entity_grants" RENAME CONSTRAINT "user_legal_entity_grants_organization_id_fkey" TO "user_legal_entity_grants_organization_id_organizations_id_fk";
ALTER TABLE public."user_legal_entity_grants" RENAME CONSTRAINT "user_legal_entity_grants_user_id_fkey" TO "user_legal_entity_grants_user_id_users_id_fk";
ALTER TABLE public."workforce_demand_forecast_issues" RENAME CONSTRAINT "workforce_demand_forecast_issues_issued_by_user_id_fkey" TO "workforce_demand_forecast_issues_issued_by_user_id_users_id_fk";
ALTER TABLE public."workforce_demand_forecast_issues" RENAME CONSTRAINT "workforce_demand_forecast_issues_organization_id_fkey" TO "workforce_demand_forecast_issues_organization_id_organizations_";
ALTER TABLE public."workforce_demand_forecast_issues" RENAME CONSTRAINT "workforce_demand_forecast_issues_worksite_id_fkey" TO "workforce_demand_forecast_issues_worksite_id_worksites_id_fk";
ALTER TABLE public."workforce_demand_forecast_scores" RENAME CONSTRAINT "workforce_demand_forecast_scores_issue_id_fkey" TO "workforce_demand_forecast_scores_issue_id_workforce_demand_fore";
ALTER TABLE public."workforce_demand_forecast_scores" RENAME CONSTRAINT "workforce_demand_forecast_scores_organization_id_fkey" TO "workforce_demand_forecast_scores_organization_id_organizations_";
ALTER TABLE public."workforce_demand_forecast_scores" RENAME CONSTRAINT "workforce_demand_forecast_scores_scored_by_user_id_fkey" TO "workforce_demand_forecast_scores_scored_by_user_id_users_id_fk";
ALTER TABLE public."workforce_demand_import_batches" RENAME CONSTRAINT "workforce_demand_import_batches_created_by_user_id_fkey" TO "workforce_demand_import_batches_created_by_user_id_users_id_fk";
ALTER TABLE public."workforce_demand_import_batches" RENAME CONSTRAINT "workforce_demand_import_batches_organization_id_fkey" TO "workforce_demand_import_batches_organization_id_organizations_i";
ALTER TABLE public."workforce_demand_import_batches" RENAME CONSTRAINT "workforce_demand_import_batches_worksite_id_fkey" TO "workforce_demand_import_batches_worksite_id_worksites_id_fk";
ALTER TABLE public."workforce_demand_observation_revisions" RENAME CONSTRAINT "workforce_demand_observation_revisions_import_batch_id_fkey" TO "workforce_demand_observation_revisions_import_batch_id_workforc";
ALTER TABLE public."workforce_demand_observation_revisions" RENAME CONSTRAINT "workforce_demand_observation_revisions_organization_id_fkey" TO "workforce_demand_observation_revisions_organization_id_organiza";
ALTER TABLE public."workforce_demand_observation_revisions" RENAME CONSTRAINT "workforce_demand_observation_revisions_worksite_id_fkey" TO "workforce_demand_observation_revisions_worksite_id_worksites_id";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_decided_by_user_id_fkey" TO "workforce_demand_staffing_policies_decided_by_user_id_users_id_";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_job_profile_id_fkey" TO "workforce_demand_staffing_policies_job_profile_id_job_profiles_";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_organization_id_fkey" TO "workforce_demand_staffing_policies_organization_id_organization";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_proposed_by_user_id_fkey" TO "workforce_demand_staffing_policies_proposed_by_user_id_users_id";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_submitted_by_user_id_fkey" TO "workforce_demand_staffing_policies_submitted_by_user_id_users_i";
ALTER TABLE public."workforce_demand_staffing_policies" RENAME CONSTRAINT "workforce_demand_staffing_policies_worksite_id_fkey" TO "workforce_demand_staffing_policies_worksite_id_worksites_id_fk";
ALTER TABLE public."workforce_demand_staffing_policy_events" RENAME CONSTRAINT "workforce_demand_staffing_policy_events_actor_user_id_fkey" TO "workforce_demand_staffing_policy_events_actor_user_id_users_id_";
ALTER TABLE public."workforce_demand_staffing_policy_events" RENAME CONSTRAINT "workforce_demand_staffing_policy_events_organization_id_fkey" TO "workforce_demand_staffing_policy_events_organization_id_organiz";
ALTER TABLE public."workforce_demand_staffing_policy_events" RENAME CONSTRAINT "workforce_demand_staffing_policy_events_policy_id_fkey" TO "workforce_demand_staffing_policy_events_policy_id_workforce_dem";
ALTER TABLE public."workforce_demand_staffing_policy_events" RENAME CONSTRAINT "workforce_demand_staffing_policy_events_prior_policy_id_fkey" TO "workforce_demand_staffing_policy_events_prior_policy_id_workfor";
