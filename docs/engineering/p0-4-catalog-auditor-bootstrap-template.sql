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
  malformed_columns text;
  malformed_constraints text;
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

  -- Names alone are not a valid control-plane schema. This checks the fixed
  -- structural contract only; authentic receipt contents and approval remain
  -- separately verified by a human DBA and the protected audit workflow.
  WITH expected(relation_name, column_name, required_type, required_typmod) AS (
    VALUES
    ('payrollph_release_migration_receipts', 'migration_path', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_release_migration_receipts', 'source_sha256', 'pg_catalog.bpchar'::pg_catalog.regtype, 68),
    ('payrollph_release_migration_receipts', 'disposition', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_release_migration_receipts', 'evidence_ref', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_release_migration_receipts', 'reviewed_by', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_release_migration_receipts', 'recorded_at', 'pg_catalog.timestamptz'::pg_catalog.regtype, -1),
    ('payrollph_migration_cutover', 'id', 'pg_catalog.int2'::pg_catalog.regtype, -1),
    ('payrollph_migration_cutover', 'historical_prefix', 'pg_catalog.int4'::pg_catalog.regtype, -1),
    ('payrollph_migration_cutover', 'historical_manifest_sha256', 'pg_catalog.bpchar'::pg_catalog.regtype, 68),
    ('payrollph_migration_cutover', 'evidence_ref', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_migration_cutover', 'reviewed_by', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_migration_cutover', 'reviewed_at', 'pg_catalog.timestamptz'::pg_catalog.regtype, -1),
    ('payrollph_schema_migrations', 'migration_path', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_schema_migrations', 'migration_number', 'pg_catalog.int4'::pg_catalog.regtype, -1),
    ('payrollph_schema_migrations', 'source_sha256', 'pg_catalog.bpchar'::pg_catalog.regtype, 68),
    ('payrollph_schema_migrations', 'applied_by', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_schema_migrations', 'change_ref', 'pg_catalog.text'::pg_catalog.regtype, -1),
    ('payrollph_schema_migrations', 'applied_at', 'pg_catalog.timestamptz'::pg_catalog.regtype, -1)
  )
  SELECT pg_catalog.string_agg(e.relation_name || '.' || e.column_name,
    ', ' ORDER BY e.relation_name, e.column_name)
  INTO malformed_columns
  FROM expected e
  JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
    AND c.relname = e.relation_name AND c.relkind IN ('r', 'p')
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
  WHERE a.attnum IS NULL
    OR a.atttypid IS DISTINCT FROM e.required_type
    OR a.atttypmod IS DISTINCT FROM e.required_typmod
    OR a.attnotnull IS DISTINCT FROM true;

  IF malformed_columns IS NOT NULL THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_JOURNAL_STRUCTURE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  -- All three journals must have their expected single-column PKs, exact
  -- column counts, and reviewed CHECK constraints. Migration numbering must
  -- also have a dedicated uniqueness constraint. Not a content attestation.
  SELECT pg_catalog.string_agg(e.relation_name, ', ' ORDER BY e.relation_name)
  INTO malformed_constraints
  FROM (VALUES
    ('payrollph_release_migration_receipts', 'migration_path', 5),
    ('payrollph_migration_cutover', 'id', 5),
    ('payrollph_schema_migrations', 'migration_path', 6)
  ) e(relation_name, pk_column, check_count)
  JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
    AND c.relname = e.relation_name AND c.relkind IN ('r', 'p')
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    AND a.attname = e.pk_column AND a.attnum > 0 AND NOT a.attisdropped
  WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute x
           WHERE x.attrelid = c.oid AND x.attnum > 0 AND NOT x.attisdropped) <> 6
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint pk
      WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND pk.convalidated
        AND pg_catalog.array_length(pk.conkey, 1) = 1
        AND pk.conkey[1] = a.attnum
    )
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint ch
          WHERE ch.conrelid = c.oid AND ch.contype = 'c'
            AND ch.convalidated) <> e.check_count;

  IF malformed_constraints IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint uq
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = uq.conrelid AND a.attnum = uq.conkey[1]
      WHERE uq.conrelid =
          pg_catalog.to_regclass('public.payrollph_schema_migrations')
        AND uq.contype = 'u'
        AND pg_catalog.array_length(uq.conkey, 1) = 1
        AND a.attname = 'migration_number'
    )
  THEN
    RAISE EXCEPTION 'CATALOG_AUDITOR_JOURNAL_CONSTRAINT_MISMATCH'
      USING ERRCODE = 'P0001';
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
