-- Issue #1015: catalog-only evidence for attendance exception ownership/SLA schema.
-- This query reads ONLY pg_catalog metadata; it NEVER reads employee, attendance
-- exception, payroll, or other application rows. No DDL, DML, or migration.
--
-- Operator: verify the intended DB/role and historical receipts independently.
-- Execute with a dedicated catalog-only role in a READ ONLY transaction.
-- PASS means structural objects exist, NOT that historical migration checksums,
-- authorizations, tenant isolation, backups or real-payroll release are approved.
-- Fixed to public.attendance_exception_events; never trust search_path.
WITH required_columns(name, expected_type, required_not_null, needs_default) AS (
  VALUES
    ('id', 'integer', true, true),
    ('organization_id', 'integer', true, false),
    ('employee_id', 'integer', true, false),
    ('work_date', 'date', true, false),
    ('exception_kind', 'character varying(40)', true, false),
    ('severity', 'character varying(16)', true, false),
    ('punch_id', 'integer', false, false),
    ('minutes', 'integer', false, false),
    ('message', 'text', true, false),
    ('fingerprint_sha256', 'character varying(64)', true, false),
    ('status', 'character varying(16)', true, true),
    ('owner_user_id', 'integer', false, false),
    ('owner_name', 'character varying(120)', false, false),
    ('sla_due_at', 'timestamp with time zone', false, false),
    ('first_detected_at', 'timestamp with time zone', true, true),
    ('last_detected_at', 'timestamp with time zone', true, true),
    ('resolved_at', 'timestamp with time zone', false, false),
    ('resolution_note', 'text', false, false),
    ('resolved_by_user_id', 'integer', false, false),
    ('resolved_by_name', 'character varying(120)', false, false),
    ('resolution_recorded_at', 'timestamp with time zone', false, false),
    ('created_at', 'timestamp with time zone', true, true),
    ('updated_at', 'timestamp with time zone', true, true)
),
relation AS (
  SELECT c.oid FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'attendance_exception_events'
    AND c.relkind IN ('r', 'p')
),
columns_actual AS (
  SELECT r.*, a.attname AS found_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS found_type,
         a.attnotnull AS found_not_null, a.atthasdef AS found_default
  FROM required_columns r
  LEFT JOIN relation t ON true
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
    AND a.attname = r.name AND a.attnum > 0 AND NOT a.attisdropped
),
required_indexes(name, required_keys, must_be_unique) AS (
  VALUES
    ('attendance_exception_events_fingerprint_unique',
      ARRAY['organization_id','employee_id','work_date','fingerprint_sha256']::text[], true),
    ('attendance_exception_events_open_idx',
      ARRAY['organization_id','status','work_date','employee_id']::text[], false),
    ('attendance_exception_events_employee_idx',
      ARRAY['organization_id','employee_id','work_date']::text[], false),
    ('attendance_exception_events_owner_idx',
      ARRAY['organization_id','status','owner_user_id','sla_due_at']::text[], false),
    ('attendance_exception_events_sla_idx',
      ARRAY['organization_id','status','sla_due_at']::text[], false)
),
indexes_actual AS (
  SELECT idx.relname AS name, i.indisunique, i.indisready, i.indisvalid,
    i.indpred IS NULL AS no_predicate, i.indexprs IS NULL AS no_expressions,
    ARRAY(
      SELECT a.attname::text
      FROM generate_series(0, i.indnkeyatts::integer - 1) AS ord(pos)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = i.indrelid AND a.attnum = i.indkey[ord.pos]
      ORDER BY ord.pos
    ) AS found_keys
  FROM pg_catalog.pg_index i
  JOIN relation t ON t.oid = i.indrelid
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = idx.relnamespace
  WHERE ns.nspname = 'public'
),
required_fks(source_column, target_table, target_column, delete_action) AS (
  VALUES
    ('organization_id','organizations','id','c'),
    ('employee_id','employees','id','c'),
    ('punch_id','time_punches','id','n'),
    ('owner_user_id','users','id','n'),
    ('resolved_by_user_id','users','id','n')
),
fks_actual AS (
  SELECT source_att.attname AS source_column,
         parent.relname AS target_table,
         target_att.attname AS target_column,
         con.confdeltype::text AS delete_action,
         con.convalidated AS validated
  FROM pg_catalog.pg_constraint con
  JOIN relation t ON t.oid = con.conrelid
  JOIN pg_catalog.pg_class parent ON parent.oid = con.confrelid
  JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  JOIN pg_catalog.pg_attribute source_att
    ON source_att.attrelid = con.conrelid AND source_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_attribute target_att
    ON target_att.attrelid = con.confrelid AND target_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_ns.nspname = 'public'
    AND array_length(con.conkey, 1) = 1 AND array_length(con.confkey, 1) = 1
),
required_checks(name, permitted_values) AS (
  VALUES
    ('attendance_exception_events_severity_check',
      ARRAY['info','warning','blocker']::text[]),
    ('attendance_exception_events_status_check',
      ARRAY['open','resolved']::text[])
),
checks_actual AS (
  SELECT con.conname AS name, con.convalidated AS validated,
         lower(pg_catalog.pg_get_constraintdef(con.oid, true)) AS definition
  FROM pg_catalog.pg_constraint con
  JOIN relation t ON t.oid = con.conrelid
  WHERE con.contype = 'c'
),
findings AS (
  SELECT 'table'::text AS area, 'attendance_exception_events'::text AS object_name,
         CASE WHEN EXISTS (SELECT 1 FROM relation) THEN 'PASS' ELSE 'MISSING' END AS status
  UNION ALL
  SELECT 'column', r.name,
         CASE WHEN a.found_name IS NULL THEN 'MISSING'
              WHEN a.found_type <> a.expected_type
                OR a.found_not_null IS DISTINCT FROM a.required_not_null
                OR (a.needs_default AND NOT a.found_default)
                THEN 'DRIFT'
              ELSE 'PASS' END
  FROM columns_actual a JOIN required_columns r ON r.name = a.name
  UNION ALL
  SELECT 'index', r.name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.found_keys IS DISTINCT FROM r.required_keys
                OR a.indisunique IS DISTINCT FROM r.must_be_unique
                OR NOT a.indisready OR NOT a.indisvalid
                OR NOT a.no_predicate OR NOT a.no_expressions THEN 'DRIFT'
              ELSE 'PASS' END
  FROM required_indexes r LEFT JOIN indexes_actual a ON a.name = r.name
  UNION ALL
  SELECT 'foreign_key', r.source_column || '->' || r.target_table || '.' || r.target_column,
         CASE WHEN a.source_column IS NULL THEN 'MISSING'
              WHEN a.target_table <> r.target_table
                OR a.target_column <> r.target_column
                OR a.delete_action <> r.delete_action OR NOT a.validated
                THEN 'DRIFT'
              ELSE 'PASS' END
  FROM required_fks r LEFT JOIN fks_actual a ON a.source_column = r.source_column
  UNION ALL
  SELECT 'check_constraint', r.name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN NOT a.validated
                OR EXISTS (
                  SELECT 1 FROM unnest(r.permitted_values) AS allowed(token)
                  WHERE position(quote_literal(allowed.token) IN a.definition) = 0
                ) THEN 'DRIFT'
              ELSE 'PASS' END
  FROM required_checks r LEFT JOIN checks_actual a ON a.name = r.name
)
SELECT area, object_name, status,
       'CATALOG_EVIDENCE_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL'::text AS evidence_scope
FROM findings
ORDER BY area, object_name;