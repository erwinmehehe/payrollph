-- P0-4 OPERATOR-ONLY PROPOSAL. THIS FILE IS NOT A MIGRATION.
--
-- DO NOT run in production before data owner, privacy/security and DBA approvals,
-- verified independently retained encrypted backup destination, approved change
-- reference, and a disposable PostgreSQL rehearsal. Creating or granting a role
-- is a persistent security change, even when it cannot log in.
--
-- Exact target: Neon project calm-wave-70219564 / default branch
-- br-lucky-sound-b79i56jw / endpoint ep-cool-hat-b7e7gpoo / neondb.
-- Transaction aborts if database identity or preconditions are not met.
--
-- No password, LOGIN, AWS resources, access to row contents, data changes,
-- migration journal writes, or automatic future-table grants are provided.
-- A separate operator would have to privately set a credential and explicitly
-- enable LOGIN after negative permission verification and backup approval.
--
-- Run only through a privately reviewed P0-4 DBA change plan. This SQL is
-- intentionally excluded from drizzle numbered migrations and CI execution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $p0_4_preflight$
BEGIN
  IF current_database() <> 'neondb'
     OR current_setting('neon.project_id', true) IS DISTINCT FROM 'calm-wave-70219564'
     OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'
     OR current_setting('neon.endpoint_id', true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'
  THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_WRONG_NEON_SOURCE';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payrollph_backup_reader')
  THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_ALREADY_EXISTS_REVIEW_MANUALLY';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'public')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'neon_auth')
  THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_REQUIRED_SCHEMAS_MISSING';
  END IF;

  -- pg_dump defaults to row-security OFF. A restricted role must not silently
  -- export a partial RLS-filtered archive. Explicitly review RLS if it appears.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'neon_auth')
      AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_RLS_REVIEW_REQUIRED';
  END IF;

  IF (
    SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ) < 136 THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_UNEXPECTED_CATALOG_SHRINKAGE';
  END IF;
END
$p0_4_preflight$;

-- The role is DELIBERATELY non-login and passwordless. It cannot connect until
-- a separate authorized operator-controlled session sets a private secret
-- and LOGIN after the below permissions have been independently verified.
CREATE ROLE payrollph_backup_reader
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;

-- Only intended database access, namespace USAGE and SELECT for pg_dump.
-- Grants on managed neon_auth data require separate privacy and role review.
GRANT CONNECT ON DATABASE neondb TO payrollph_backup_reader;
GRANT USAGE ON SCHEMA public, neon_auth TO payrollph_backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, neon_auth TO payrollph_backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, neon_auth TO payrollph_backup_reader;

-- Defense in depth; NOT a substitute for correct effective privileges.
ALTER ROLE payrollph_backup_reader SET default_transaction_read_only = on;

DO $p0_4_postflight$
DECLARE
  reader_id oid;
BEGIN
  SELECT oid INTO reader_id FROM pg_catalog.pg_roles
  WHERE rolname = 'payrollph_backup_reader';

  IF reader_id IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid = reader_id
      AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
        OR r.rolreplication OR r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_FLAGS_UNSAFE';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = reader_id)
     OR pg_catalog.has_database_privilege(reader_id, current_database(), 'CREATE')
  THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_ELEVATED_OR_MEMBER_ROLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname IN ('public', 'neon_auth')
      AND (NOT pg_catalog.has_schema_privilege(reader_id, n.oid, 'USAGE')
        OR pg_catalog.has_schema_privilege(reader_id, n.oid, 'CREATE'))
  ) THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_SCHEMA_PRIVILEGES_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'neon_auth') AND c.relkind IN ('r', 'p')
      AND (NOT pg_catalog.has_table_privilege(reader_id, c.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(
          reader_id, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'
        ) OR c.relowner = reader_id)
  ) THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_TABLE_PRIVILEGES_INVALID';
  END IF;

  -- Filter physical sequences in a MATERIALIZED CTE before asking PostgreSQL
  -- about sequence privileges; never apply has_sequence_privilege to tables.
  IF EXISTS (
    WITH sequences AS MATERIALIZED (
      SELECT c.oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'neon_auth') AND c.relkind = 'S'
    )
    SELECT 1 FROM sequences s
    WHERE NOT pg_catalog.has_sequence_privilege(reader_id, s.oid, 'SELECT')
       OR pg_catalog.has_sequence_privilege(reader_id, s.oid, 'USAGE,UPDATE')
  ) THEN
    RAISE EXCEPTION 'P0_4_BACKUP_READER_SEQUENCE_PRIVILEGES_INVALID';
  END IF;
END
$p0_4_postflight$;

-- No automatic role activation. Future new tables/sequences require another
-- separately approved SELECT grant followed by the same guard checks.
COMMIT;
