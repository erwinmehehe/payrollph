-- #1031 read-only catalog-only financial schema readiness evidence.
-- NOT a migration receipt, permission to deploy, or authorization to read customer rows.
WITH required_tables(table_name) AS (
  VALUES
    ('government_filing_validations'),
    ('user_permission_assignments'),
    ('permission_sets'),
    ('dynamic_worker_groups'),
    ('job_grades'),
    ('job_profiles'),
    ('positions'),
    ('position_assignments'),
    ('workforce_timesheets'),
    ('attendance_exception_events'),
    ('compensation_bands'),
    ('compensation_components'),
    ('compensation_cycles'),
    ('compensation_proposals'),
    ('employee_compensation_components'),
    ('employee_payout_change_requests')
),
required_columns(table_name, column_name, expected_type) AS (
  VALUES
    ('government_filing_validations', 'applicable_month', 'character varying(7)'),
    ('government_filing_validations', 'employee_count', 'integer'),
    ('government_filing_validations', 'reported_total', 'numeric(14,2)'),
    ('government_filing_validations', 'legal_entity_id', 'integer'),
    ('user_permission_assignments', 'dynamic_group_id', 'integer'),
    ('job_requisitions', 'position_id', 'integer')
),
table_results AS (
  SELECT 'table'::text AS area, t.table_name::text AS object_name,
    CASE WHEN c.oid IS NULL THEN 'MISSING' ELSE 'PASS' END::text AS status
  FROM required_tables t
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
    AND c.relname = t.table_name AND c.relkind IN ('r','p')
),
column_results AS (
  SELECT 'column'::text AS area,
    (x.table_name || '.' || x.column_name)::text AS object_name,
    CASE WHEN a.attnum IS NULL THEN 'MISSING'
      WHEN pg_catalog.format_type(a.atttypid, a.atttypmod) <> x.expected_type THEN 'DRIFT'
      ELSE 'PASS' END::text AS status
  FROM required_columns x
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
    AND c.relname = x.table_name AND c.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    AND a.attname = x.column_name AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT area, object_name, status,
  'CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL'::text AS evidence_scope
FROM table_results
UNION ALL
SELECT area, object_name, status,
  'CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL'::text AS evidence_scope
FROM column_results
ORDER BY area, object_name;
