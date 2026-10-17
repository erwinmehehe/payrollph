-- Issue #1198 — READ-ONLY catalog worksheet; no production execution authorized.
-- DBA must FIRST independently attest runtime target and restricted LOGIN per #1078.
-- This is NOT a replacement for the protected, fail-closed CI audit workflows.
-- Outputs (role, endpoint, schema names) belong only in a private DBA evidence vault.
-- It cannot prove a SQL migration was historically executed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '7000ms';
SET LOCAL lock_timeout = '2000ms';
SET LOCAL search_path = pg_catalog;

-- Session identity; matching Neon GUCs do not independently attest Vercel runtime.
SELECT clock_timestamp() AS observed_utc, current_database() AS database_name,
       session_user AS session_role, current_user AS effective_role,
       current_setting('transaction_read_only') AS read_only,
       current_setting('server_version') AS postgres_version,
       current_setting('neon.project_id', true) AS neon_project,
       current_setting('neon.branch_id', true) AS neon_branch,
       current_setting('neon.endpoint_id', true) AS neon_endpoint;

-- Catalog role properties. Review effective inherited grants independently.
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
       r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit
FROM pg_catalog.pg_roles r
WHERE r.rolname = current_user
   OR r.rolname IN ('payrollph_schema_auditor', 'payrollph_catalog_audit_1031')
ORDER BY r.rolname;

SELECT member.rolname AS member_role, parent.rolname AS inherited_role,
       am.inherit_option, am.set_option, am.admin_option
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles member ON member.oid=am.member
JOIN pg_catalog.pg_roles parent ON parent.oid=am.roleid
WHERE member.rolname = current_user
ORDER BY parent.rolname;

-- Only privilege booleans on public tables. No SELECT from application tables.
WITH application_tables AS (
  SELECT c.oid, c.relname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT count(*) AS tables_examined,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege(current_user,oid,'SELECT')) AS readable_table_count,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege(current_user,oid,'INSERT')) AS insertable_table_count,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege(current_user,oid,'UPDATE')) AS updatable_table_count,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege(current_user,oid,'DELETE')) AS deletable_table_count,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege(current_user,oid,'TRUNCATE')) AS truncatable_table_count
FROM application_tables;

-- Object existence only: DOES NOT read or create migration journal rows.
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS object_kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND c.relkind IN ('r','p','v','m')
  AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%journal%'
       OR c.relname ILIKE '%receipt%' OR c.relname ILIKE '%cutover%')
ORDER BY n.nspname,c.relname;

-- Current effects of named historical sources; NOT a claim they ran or never ran.
WITH expected(schema_name, object_name, candidate_source) AS (
  VALUES
    ('public','job_profiles','0022/0051'),
    ('public','positions','0022/0051'),
    ('public','position_assignments','0022/0051'),
    ('public','worker_employment_events','0050'),
    ('public','audit_events','0109'),
    ('public','audit_chain_heads','0109'),
    ('public','provider_events','0110'),
    ('public','workforce_demand_import_batches','0112'),
    ('public','workforce_demand_observation_revisions','0112'),
    ('public','workforce_demand_forecast_issues','0113'),
    ('public','workforce_demand_forecast_scores','0113'),
    ('public','workforce_demand_staffing_policies','0114'),
    ('public','workforce_demand_staffing_policy_events','0114'),
    ('public','compensation_automation_intents','compensation'),
    ('public','payrollph_release_migration_receipts','release-journal'),
    ('public','payrollph_migration_cutover','cutover'),
    ('public','payrollph_schema_migrations','release-journal'),
    ('drizzle','__drizzle_migrations','Drizzle-journal')
)
SELECT candidate_source, schema_name || '.' || object_name AS object_name,
       CASE WHEN pg_catalog.to_regclass(
         pg_catalog.quote_ident(schema_name)||'.'||pg_catalog.quote_ident(object_name)
       ) IS NULL THEN 'ABSENT' ELSE 'PRESENT' END AS catalog_presence,
       'HISTORICAL_EXECUTION_UNPROVEN' AS migration_execution
FROM expected ORDER BY candidate_source,object_name;

-- Check audit protection definitions without executing any application function.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS signature
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('audit_events_protect','seal_audit_events')
ORDER BY p.proname, signature;

SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('audit_events','audit_chain_heads')
  AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;

-- Structural inventory: pg_catalog ONLY; no application rows.
SELECT n.nspname AS schema_name,c.relname AS object_name,c.relkind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
ORDER BY c.relname;

SELECT c.relname AS table_name,a.attname AS column_name,
       pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull AS not_null,a.attidentity,a.attgenerated
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum;

SELECT c.relname AS table_name,k.conname AS constraint_name,k.contype,
       pg_catalog.pg_get_constraintdef(k.oid,true) AS definition
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
ORDER BY c.relname,k.conname;

SELECT schemaname,tablename,indexname,indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname='public'
ORDER BY tablename,indexname;

ROLLBACK;
