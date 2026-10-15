-- Issue #1031. Catalog-only diagnostic for the three failing Workforce Planning and BI GETs.
-- READ ONLY: no business-row reads, joins, DDL, DML, migrations, or runtime fallback.
-- Table presence is NOT a historical applied-migration receipt or production approval.
-- A zero-missing result is necessary but NOT sufficient; reconcile types/FKs/indexes
-- and authorization, then execute tenant-scoped route and worker tests separately.
WITH required(endpoint, relation_name, column_name) AS (
  VALUES
  ('role_gate', 'user_organizations', 'id'),
  ('role_gate', 'user_organizations', 'organization_id'),
  ('role_gate', 'user_organizations', 'user_id'),
  ('role_gate', 'user_organizations', 'role'),
  ('role_gate', 'user_organizations', 'active'),
  ('role_gate', 'permission_sets', 'id'),
  ('role_gate', 'permission_sets', 'organization_id'),
  ('role_gate', 'permission_sets', 'permissions'),
  ('role_gate', 'permission_sets', 'active'),
  ('role_gate', 'user_permission_assignments', 'id'),
  ('role_gate', 'user_permission_assignments', 'organization_id'),
  ('role_gate', 'user_permission_assignments', 'user_organization_id'),
  ('role_gate', 'user_permission_assignments', 'permission_set_id'),
  ('role_gate', 'user_permission_assignments', 'dynamic_group_id'),
  ('role_gate', 'user_permission_assignments', 'dynamic_group_version'),
  ('role_gate', 'dynamic_worker_groups', 'id'),
  ('role_gate', 'dynamic_worker_groups', 'organization_id'),
  ('role_gate', 'dynamic_worker_groups', 'active'),
  ('workforce_planning', 'job_profiles', 'id'),
  ('workforce_planning', 'job_profiles', 'organization_id'),
  ('workforce_planning', 'job_profiles', 'title'),
  ('workforce_planning', 'job_profiles', 'family_id'),
  ('workforce_planning', 'job_profiles', 'level_id'),
  ('workforce_planning', 'job_profiles', 'grade_id'),
  ('workforce_planning', 'job_families', 'id'),
  ('workforce_planning', 'job_families', 'organization_id'),
  ('workforce_planning', 'job_families', 'name'),
  ('workforce_planning', 'job_levels', 'id'),
  ('workforce_planning', 'job_levels', 'organization_id'),
  ('workforce_planning', 'job_levels', 'sequence'),
  ('workforce_planning', 'job_grades', 'id'),
  ('workforce_planning', 'job_grades', 'organization_id'),
  ('workforce_planning', 'job_grades', 'sequence'),
  ('workforce_planning', 'workforce_plans', 'id'),
  ('workforce_planning', 'workforce_plans', 'organization_id'),
  ('workforce_planning', 'workforce_plans', 'start_date'),
  ('workforce_planning', 'positions', 'id'),
  ('workforce_planning', 'positions', 'organization_id'),
  ('workforce_planning', 'positions', 'job_profile_id'),
  ('workforce_planning', 'positions', 'org_unit_id'),
  ('workforce_planning', 'positions', 'annual_budget'),
  ('workforce_planning', 'position_assignments', 'id'),
  ('workforce_planning', 'position_assignments', 'organization_id'),
  ('workforce_planning', 'position_assignments', 'position_id'),
  ('workforce_planning', 'position_assignments', 'employee_id'),
  ('workforce_planning', 'org_units', 'id'),
  ('workforce_planning', 'org_units', 'organization_id'),
  ('workforce_planning', 'org_units', 'name'),
  ('workforce_planning', 'org_units', 'active'),
  ('workforce_planning', 'legal_entities', 'id'),
  ('workforce_planning', 'legal_entities', 'organization_id'),
  ('workforce_planning', 'legal_entities', 'display_name'),
  ('workforce_planning', 'cost_centers', 'id'),
  ('workforce_planning', 'cost_centers', 'organization_id'),
  ('workforce_planning', 'cost_centers', 'name'),
  ('workforce_planning', 'employees', 'id'),
  ('workforce_planning', 'employees', 'organization_id'),
  ('workforce_planning', 'employees', 'first_name'),
  ('workforce_planning', 'employees', 'last_name'),
  ('workforce_planning', 'job_requisitions', 'id'),
  ('workforce_planning', 'job_requisitions', 'organization_id'),
  ('workforce_planning', 'job_requisitions', 'position_id'),
  ('workforce_planning', 'worksites', 'id'),
  ('workforce_planning', 'worksites', 'organization_id'),
  ('workforce_planning', 'worksites', 'name'),
  ('workforce_planning', 'shift_definitions', 'id'),
  ('workforce_planning', 'shift_definitions', 'organization_id'),
  ('workforce_planning', 'shift_definitions', 'active'),
  ('workforce_allocations', 'workforce_plan_allocations', 'id'),
  ('workforce_allocations', 'workforce_plan_allocations', 'organization_id'),
  ('workforce_allocations', 'workforce_plan_allocations', 'plan_id'),
  ('workforce_allocations', 'workforce_plan_allocations', 'org_unit_id'),
  ('workforce_allocations', 'workforce_plan_manager_submissions', 'id'),
  ('workforce_allocations', 'workforce_plan_manager_submissions', 'organization_id'),
  ('workforce_allocations', 'workforce_plan_manager_submissions', 'allocation_id'),
  ('workforce_allocations', 'workforce_plan_manager_submissions', 'org_unit_id'),
  ('workforce_allocations', 'org_units', 'id'),
  ('workforce_allocations', 'org_units', 'organization_id'),
  ('workforce_allocations', 'org_units', 'name'),
  ('bi_export_definitions', 'legal_entities', 'id'),
  ('bi_export_definitions', 'legal_entities', 'organization_id'),
  ('bi_export_definitions', 'legal_entities', 'display_name'),
  ('bi_export_definitions', 'org_units', 'id'),
  ('bi_export_definitions', 'org_units', 'organization_id'),
  ('bi_export_definitions', 'org_units', 'legal_entity_id'),
  ('bi_export_definitions', 'dynamic_worker_groups', 'id'),
  ('bi_export_definitions', 'dynamic_worker_groups', 'organization_id'),
  ('bi_export_definitions', 'dynamic_worker_groups', 'active'),
  ('bi_export_definitions', 'dynamic_worker_groups', 'version'),
  ('bi_export_generation', 'payroll_runs', 'id'),
  ('bi_export_generation', 'payroll_runs', 'organization_id'),
  ('bi_export_generation', 'payroll_runs', 'period_start'),
  ('bi_export_generation', 'payroll_entries', 'id'),
  ('bi_export_generation', 'payroll_entries', 'organization_id'),
  ('bi_export_generation', 'payroll_entries', 'payroll_run_id'),
  ('bi_export_generation', 'workforce_timesheets', 'id'),
  ('bi_export_generation', 'workforce_timesheets', 'organization_id'),
  ('bi_export_generation', 'employees', 'id'),
  ('bi_export_generation', 'employees', 'organization_id')
), catalog AS (
  SELECT r.*,
    to_regclass('public.' || r.relation_name) AS relation_oid
  FROM required r
), presence AS (
  SELECT c.*,
    CASE WHEN c.relation_oid IS NULL THEN 'MISSING_RELATION'
         WHEN a.attname IS NULL THEN 'MISSING_COLUMN'
         ELSE 'PRESENT' END AS status
  FROM catalog c
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.relation_oid
   AND a.attname = c.column_name
   AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT endpoint,
  count(*) FILTER (WHERE status != 'PRESENT') AS missing_required_fields,
  coalesce(array_agg(DISTINCT relation_name ORDER BY relation_name)
    FILTER (WHERE status = 'MISSING_RELATION'), ARRAY[]::text[]) AS missing_relations,
  coalesce(array_agg(relation_name || '.' || column_name ORDER BY relation_name, column_name)
    FILTER (WHERE status = 'MISSING_COLUMN'), ARRAY[]::text[]) AS missing_columns,
  CASE WHEN count(*) FILTER (WHERE status != 'PRESENT') = 0
    THEN 'CATALOG_FIELDS_PRESENT_NOT_A_RELEASE_APPROVAL'
    ELSE 'BLOCKED_MIGRATION_REQUIRED' END AS disposition
FROM presence
GROUP BY endpoint
ORDER BY endpoint;
