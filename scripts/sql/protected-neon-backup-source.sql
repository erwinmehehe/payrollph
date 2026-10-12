-- Metadata-only backup source identity and read-only role assertion.
-- Does not inspect tenant/payroll/bank data. Any missing Neon GUC fails CLOSED.
SELECT CASE WHEN
    current_database() = 'neondb'
    AND current_setting('neon.project_id',true) = 'calm-wave-70219564'
    AND current_setting('neon.branch_id',true) = 'br-lucky-sound-b79i56jw'
    AND current_setting('neon.endpoint_id',true) = 'ep-cool-hat-b7e7gpoo'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
      AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
        OR r.rolreplication OR r.rolbypassrls)
    )
    AND NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE')
    AND NOT pg_catalog.has_database_privilege(current_user,current_database(),'CREATE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND pg_catalog.has_table_privilege(current_user,c.oid,
          'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
    )
THEN 'PINNED_READ_ONLY_SOURCE' ELSE 'DENIED' END AS safety;
