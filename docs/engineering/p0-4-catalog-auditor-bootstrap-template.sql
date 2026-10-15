-- P0-4 MANUAL DBA-ONLY ROLE BOOTSTRAP TEMPLATE.
-- Do not run on production until: verified independent off-provider backup
-- and restore, reconciled historical migration evidence, DBA/security change
-- approval, and all THREE independently adopted migration tables exist.
--
-- This template does NOT create migration receipts, adopt a historical
-- baseline, execute feature migrations, grant payroll-row access, set a
-- password, enable LOGIN, or approve any production release.
-- Use a reviewed direct Neon connection with psql ON_ERROR_STOP=1.
-- On ANY error, the transaction must roll back. Never use db:push.
BEGIN;
SET LOCAL lock_timeout = '3000ms';
SET LOCAL statement_timeout = '10000ms';

DO $catalog_auditor_preflight$
DECLARE
  present_tables integer;
BEGIN
  IF current_database() <> 'neondb'
    OR current_setting('neon.project_id', true) IS DISTINCT FROM 'calm-wave-70219564'
    OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'
    OR current_setting('neon.endpoint_id', true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'
  THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_WRONG_NEON_PRODUCTION_TARGET';
  END IF;

  IF pg_catalog.to_regrole('payrollph_migration_catalog_auditor') IS NOT NULL THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_EXISTING_ROLE_REQUIRES_DBA_REVIEW';
  END IF;

  SELECT pg_catalog.count(*) INTO present_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'payrollph_release_migration_receipts',
      'payrollph_migration_cutover',
      'payrollph_schema_migrations'
    );
  IF present_tables <> 3 THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_REQUIRES_AUTHENTIC_DBA_ADOPTED_JOURNALS';
  END IF;
END
$catalog_auditor_preflight$;

-- NOLOGIN by design. Independent DBA must provision a vaulted secret and
-- authorize LOGIN only in a separately approved security change.
CREATE ROLE payrollph_migration_catalog_auditor
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE neondb TO payrollph_migration_catalog_auditor;
GRANT USAGE ON SCHEMA public TO payrollph_migration_catalog_auditor;
GRANT SELECT ON TABLE
  public.payrollph_release_migration_receipts,
  public.payrollph_migration_cutover,
  public.payrollph_schema_migrations
  TO payrollph_migration_catalog_auditor;

DO $catalog_auditor_postflight$
DECLARE
  privileged_role boolean;
  unexpected_access boolean;
BEGIN
  SELECT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
      OR r.rolreplication OR r.rolbypassrls OR r.rolcanlogin OR r.rolinherit)
    INTO privileged_role
  FROM pg_catalog.pg_roles r
  WHERE r.rolname = 'payrollph_migration_catalog_auditor';
  IF privileged_role IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_ROLE_FLAGS_NOT_RESTRICTED';
  END IF;

  IF pg_catalog.has_schema_privilege('payrollph_migration_catalog_auditor', 'public', 'CREATE')
    OR pg_catalog.has_database_privilege('payrollph_migration_catalog_auditor', current_database(), 'CREATE')
  THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_UNEXPECTED_DDL_PRIVILEGES';
  END IF;

  IF NOT (
    pg_catalog.has_table_privilege('payrollph_migration_catalog_auditor',
      'public.payrollph_release_migration_receipts', 'SELECT')
    AND pg_catalog.has_table_privilege('payrollph_migration_catalog_auditor',
      'public.payrollph_migration_cutover', 'SELECT')
    AND pg_catalog.has_table_privilege('payrollph_migration_catalog_auditor',
      'public.payrollph_schema_migrations', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_RECEIPT_READ_GRANTS_MISSING';
  END IF;

  -- The three reviewed migration-control tables are the ONLY public data
  -- relations readable by this audit role. Also deny managed Auth reads.
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'neon_auth')
      AND c.relkind IN ('r', 'p')
      AND (
        pg_catalog.has_table_privilege('payrollph_migration_catalog_auditor', c.oid,
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR (
          pg_catalog.has_any_column_privilege('payrollph_migration_catalog_auditor',
            c.oid, 'SELECT')
          AND NOT (n.nspname = 'public' AND c.relname IN (
            'payrollph_release_migration_receipts',
            'payrollph_migration_cutover',
            'payrollph_schema_migrations'
          ))
        )
      )
  ) INTO unexpected_access;

  IF unexpected_access THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_UNEXPECTED_APPLICATION_OR_AUTH_ACCESS';
  END IF;
END
$catalog_auditor_postflight$;

COMMIT;
-- No LOGIN, password, historical row receipt or payroll authority is created.
