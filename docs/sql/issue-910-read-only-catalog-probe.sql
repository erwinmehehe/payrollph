-- #910 SELECT-ONLY database catalog snapshot. REVIEW USE ONLY.
-- Does not identify the executing migration SHA, approve schema changes, or
-- establish historical employer attribution. Scope explicitly to verified
-- Neon project/branch outside this query (not a default-branch assumption).
WITH expected(source_stage, table_name) AS (
 VALUES
 ('0022','job_profiles'),
 ('0022','workforce_plans'),
 ('0022','positions'),
 ('0022','position_assignments'),
 ('0050','worker_employment_events'),
 ('0051','job_families'),
 ('0051','job_levels'),
 ('0051','job_grades'),
 ('0052','worker_effective_changes'),
 ('0110','provider_events'),
 ('0112','workforce_demand_import_batches'),
 ('0112','workforce_demand_observation_revisions'),
 ('0113','workforce_demand_forecast_issues'),
 ('0113','workforce_demand_forecast_scores'),
 ('0114','workforce_demand_staffing_policies'),
 ('0114','workforce_demand_staffing_policy_events'),
 ('0115','payout_profiles'),
 ('0116','payout_batches'),
 ('0116','payout_transfers'),
 ('0120','workforce_punch_photo_evidence'),
 ('0120','workforce_punch_submissions'),
 ('0121','user_legal_entity_grants'),
 ('0121','employee_entity_assignments'),
 ('0121','entity_transfer_requests'),
 ('registration','legal_entity_profile_change_requests'),
 ('registration','legal_entity_statutory_registrations')
),
known_objects AS (
 SELECT source_stage, table_name,
   (to_regclass(format('public.%I', table_name)) IS NOT NULL) AS is_present
 FROM expected
),
migration_name_matches AS (
 SELECT n.nspname AS schema_name, c.relname AS object_name
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p','v','m')
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%receipt%'
        OR c.relname ILIKE '%journal%' OR n.nspname = 'drizzle')
),
structural_snapshots AS (
 SELECT (SELECT count(*)::integer FROM pg_catalog.pg_tables
         WHERE schemaname = 'public') AS public_table_count,
   (SELECT count(*)::integer FROM information_schema.columns
         WHERE table_schema='public' AND table_name='workforce_plans') AS workforce_plans_columns,
   (SELECT count(*)::integer FROM information_schema.columns
         WHERE table_schema='public' AND table_name='org_units') AS org_units_columns,
   (SELECT count(*)::integer FROM pg_catalog.pg_indexes
         WHERE schemaname='public' AND tablename='workforce_plans') AS workforce_plans_indexes,
   (SELECT count(*)::integer FROM migration_name_matches) AS migration_name_match_count,
   (SELECT count(*)::integer FROM pg_catalog.pg_tables
         WHERE schemaname='public' AND tablename IN
           ('ess_employee_photos','ess_identifier_requests','ess_other_identifiers')) AS ess_drift_tables
)
SELECT current_database() AS database_name,
       current_setting('server_version') AS postgresql_version,
       now() AT TIME ZONE 'UTC' AS observed_utc,
       s.public_table_count, s.workforce_plans_columns,
       s.org_units_columns, s.workforce_plans_indexes,
       s.migration_name_match_count, s.ess_drift_tables,
       (SELECT jsonb_agg(
           jsonb_build_object(
             'source_stage', source_stage,
             'table', table_name,
             'catalog_status', CASE WHEN is_present THEN 'PRESENT' ELSE 'ABSENT' END,
             'execution_status', 'UNPROVEN'
           )
           ORDER BY source_stage, table_name
         ) FROM known_objects) AS source_object_status
FROM structural_snapshots s;
