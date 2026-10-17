-- #1113: promote the tested worksite decision repair after merged 0129.
-- Source merge does not authorize production execution; protected exact-SHA
-- ordered runner, historical receipts, target identity and backup gates apply.
DO $issue1113_worksite_decision$
DECLARE
  target_oid oid;
  bad_columns text;
  bad_foreign_keys text;
BEGIN
  target_oid := pg_catalog.to_regclass('public.employee_worksite_assignments');
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'ISSUE1113_WORKSITE_ASSIGNMENTS_TABLE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  -- A short, fail-fast exclusive lock prevents a simultaneous schema change
  -- between catalog verification and the ALTER; do not wait on busy tenants.
  LOCK TABLE public.employee_worksite_assignments IN ACCESS EXCLUSIVE MODE NOWAIT;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class rel
    JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE rel.oid = target_oid AND ns.nspname = 'public'
      AND rel.relkind = 'r' AND rel.relpersistence = 'p'
  ) THEN
    RAISE EXCEPTION 'ISSUE1113_UNEXPECTED_WORKSITE_RELATION'
      USING ERRCODE = 'P0001';
  END IF;

  -- Any pre-existing decision column (even correct-looking) requires a
  -- historical receipt/disposition review. Never claim a no-op as applied.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = target_oid AND a.attname = 'decision'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.string_agg(expected.name, ', ' ORDER BY expected.name)
    INTO bad_columns
  FROM (VALUES
    ('id', 'integer', true),
    ('organization_id', 'integer', true),
    ('employee_id', 'integer', true),
    ('worksite_id', 'integer', true),
    ('effective_from', 'date', true),
    ('effective_until', 'date', false),
    ('reason', 'character varying(240)', true),
    ('created_by', 'character varying(120)', true),
    ('created_at', 'timestamp with time zone', true)
  ) AS expected(name, sql_type, not_null)
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = target_oid AND a.attname = expected.name
      AND a.attnum > 0 AND NOT a.attisdropped
  WHERE a.attnum IS NULL
    OR pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.sql_type
    OR a.attnotnull IS DISTINCT FROM expected.not_null;

  IF bad_columns IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1113_PREEXISTING_COLUMNS_DRIFTED: %', bad_columns
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint pk
    JOIN pg_catalog.pg_attribute id ON id.attrelid = pk.conrelid
      AND id.attname = 'id' AND id.attnum > 0 AND NOT id.attisdropped
    WHERE pk.conrelid = target_oid AND pk.contype = 'p'
      AND pk.convalidated AND pk.conkey = ARRAY[id.attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'ISSUE1113_PREEXISTING_PRIMARY_KEY_DRIFTED'
      USING ERRCODE = 'P0001';
  END IF;

  -- Preserve tenant/worker/worksite foreign keys and DELETE policies.
  -- A missing or weakened FK must be separately reconciled, never papered over
  -- by an otherwise-valid added column.
  SELECT pg_catalog.string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
    INTO bad_foreign_keys
  FROM (VALUES
    ('organization_id', 'organizations', 'c'),
    ('employee_id', 'employees', 'c'),
    ('worksite_id', 'worksites', 'r')
  ) AS expected(column_name, parent_name, delete_action)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_attribute src ON src.attrelid = fk.conrelid
      AND src.attname = expected.column_name
      AND src.attnum > 0 AND NOT src.attisdropped
    JOIN pg_catalog.pg_attribute dest ON dest.attrelid = fk.confrelid
      AND dest.attname = 'id' AND dest.attnum > 0 AND NOT dest.attisdropped
    WHERE fk.conrelid = target_oid AND fk.contype = 'f'
      AND fk.confrelid = pg_catalog.to_regclass('public.' || expected.parent_name)
      AND fk.conkey = ARRAY[src.attnum]::smallint[]
      AND fk.confkey = ARRAY[dest.attnum]::smallint[]
      AND fk.confdeltype = expected.delete_action::"char"
      AND fk.confupdtype = 'a' AND fk.convalidated
      AND NOT fk.condeferrable
  );

  IF bad_foreign_keys IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1113_PREEXISTING_TENANT_FOREIGN_KEYS_DRIFTED: %', bad_foreign_keys
      USING ERRCODE = 'P0001';
  END IF;

  -- No IF NOT EXISTS, no DML/backfill and no payroll or separation records.
  -- PostgreSQL 16/18 can apply a constant NOT NULL DEFAULT without rewriting
  -- existing heap rows, but the ACCESS EXCLUSIVE lock still needs approval.
  EXECUTE 'ALTER TABLE public.employee_worksite_assignments '
       || 'ADD COLUMN decision varchar(8) NOT NULL DEFAULT ''allow''';

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef def
      ON def.adrelid = a.attrelid AND def.adnum = a.attnum
    WHERE a.attrelid = target_oid AND a.attname = 'decision'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'pg_catalog.varchar'::pg_catalog.regtype
      AND a.atttypmod = 12 AND a.attnotnull
      AND pg_catalog.pg_get_expr(def.adbin, def.adrelid)
        IN ('''allow''::character varying', '''allow''::character varying(8)')
  ) THEN
    RAISE EXCEPTION 'ISSUE1113_POSTFLIGHT_DECISION_SCHEMA_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;
END
$issue1113_worksite_decision$;
