/**
 * #1054 immutable migration companion. Preflight-only, catalog-only.
 * Executed BEFORE original 0125 SQL by the protected reviewed runner
 * in its same transaction. Historical 0125 and its checksum stay unchanged.
 * Not production approval or a substitute for independent DBA review.
 */
export const ISSUE1054_MIGRATION_PATH = "drizzle/0125_wfm_availability_open_shifts_forward_repair.sql";
export const ISSUE1054_PREFLIGHT_SQL = String.raw`DO $issue1054_preflight$
DECLARE
  missing_objects text;
  invalid_parents text;
BEGIN
  SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO missing_objects
  FROM (VALUES
    ('public.organizations'), ('public.employees'), ('public.users'),
    ('public.worksites'), ('public.shift_definitions'),
    ('public.job_profiles'), ('public.staffing_requirements')
  ) AS required(object_name)
  WHERE to_regclass(object_name) IS NULL;

  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_MISSING_PREREQUISITES: %', missing_objects
      USING ERRCODE = 'P0001';
  END IF;

  -- A relation name is not an adequate FK prerequisite. Check the seven
  -- actual parents for a single integer(id) primary key in public.
  SELECT pg_catalog.string_agg(required.name, ', ' ORDER BY required.name)
    INTO invalid_parents
  FROM (VALUES
    ('organizations'), ('employees'), ('users'), ('worksites'),
    ('shift_definitions'), ('job_profiles'), ('staffing_requirements')
  ) AS required(name)
  LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class parent
    ON parent.relnamespace = ns.oid
    AND parent.relname = required.name AND parent.relkind IN ('r', 'p')
  LEFT JOIN pg_catalog.pg_attribute id
    ON id.attrelid = parent.oid AND id.attname = 'id'
    AND id.attnum > 0 AND NOT id.attisdropped
  WHERE parent.oid IS NULL
     OR id.atttypid IS NULL
     OR pg_catalog.format_type(id.atttypid, id.atttypmod) <> 'integer'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint pk
       WHERE pk.conrelid = parent.oid AND pk.contype = 'p'
         AND pg_catalog.array_length(pk.conkey, 1) = 1
         AND pk.conkey[1] = id.attnum
         AND pk.convalidated
     );

  IF invalid_parents IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_PARENT_INTEGER_PK_MISSING_OR_DRIFTED: %',
      invalid_parents USING ERRCODE = 'P0001';
  END IF;

  -- An index name alone is not evidence of role-scoped uniqueness. Refuse
  -- a swapped/wrong-key index even when it uses the expected historical name.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    WHERE idx.oid = to_regclass('public.staffing_requirement_role_unique')
      AND idx.relkind = 'i' AND am.amname = 'btree'
      AND i.indrelid = to_regclass('public.staffing_requirements')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indnullsnotdistinct
      AND i.indpred IS NULL AND i.indnkeyatts = 5 AND i.indnatts = 5
      -- The key deparser includes sort order, collations and opclasses; these
      -- must match the reviewed role-scoped expression, not an ILIKE substring.
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'organization_id'
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) = 'worksite_id'
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) = 'work_date'
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 4, true) = 'shift_definition_id'
      AND pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_indexdef(i.indexrelid, 5, true)),
        '[[:space:]]', '', 'g') = 'coalesce(job_profile_id,0)'
  ) THEN
    RAISE EXCEPTION 'ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.staffing_requirement_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_LEGACY_STAFFING_UNIQUENESS_PRESENT'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.employee_availability_rules') IS NOT NULL
     OR to_regclass('public.open_shifts') IS NOT NULL
     OR to_regclass('public.open_shift_claims') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION'
      USING ERRCODE = 'P0001';
  END IF;

  -- A dropped table can leave a free-standing SERIAL sequence or an index
  -- name reserved on an unrelated relation. No IF NOT EXISTS is permitted.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class obj
    JOIN pg_catalog.pg_namespace ns ON ns.oid = obj.relnamespace
    WHERE ns.nspname = 'public' AND obj.relname = ANY (ARRAY[
      'employee_availability_rules_id_seq', 'employee_availability_rules_pkey', 'employee_availability_employee_idx',
      'employee_availability_effective_idx', 'open_shifts_id_seq', 'open_shifts_pkey',
      'open_shifts_org_date_idx', 'open_shifts_worksite_idx', 'open_shifts_role_idx',
      'open_shift_claims_id_seq', 'open_shift_claims_pkey', 'open_shift_claim_unique',
      'open_shift_claim_org_status_idx', 'open_shift_claim_employee_idx'
    ])
  ) THEN
    RAISE EXCEPTION 'ISSUE1054_ORPHANED_INDEX_OR_SEQUENCE'
      USING ERRCODE = 'P0001';
  END IF;

  -- PostgreSQL constraints cannot exist without an owning table, but a
  -- different table can occupy a reviewed FK constraint name. Reject those
  -- ambiguous catalog states rather than claiming a clean starting schema.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_namespace ns ON ns.oid = con.connamespace
    WHERE ns.nspname = 'public' AND con.conname = ANY (ARRAY[
      'employee_availability_rules_organization_id_organizations_id_fk', 'employee_availability_rules_employee_id_employees_id_fk',
      'employee_availability_rules_created_by_user_id_users_id_fk', 'open_shifts_organization_id_organizations_id_fk',
      'open_shifts_worksite_id_worksites_id_fk', 'open_shifts_shift_definition_id_shift_definitions_id_fk',
      'open_shifts_job_profile_id_job_profiles_id_fk', 'open_shifts_source_requirement_id_staffing_requirements_id_fk',
      'open_shifts_created_by_user_id_users_id_fk', 'open_shift_claims_organization_id_organizations_id_fk',
      'open_shift_claims_open_shift_id_open_shifts_id_fk', 'open_shift_claims_employee_id_employees_id_fk',
      'open_shift_claims_requested_by_user_id_users_id_fk', 'open_shift_claims_decided_by_user_id_users_id_fk'
    ])
  ) THEN
    RAISE EXCEPTION 'ISSUE1054_RESERVED_CONSTRAINT_NAME_COLLISION'
      USING ERRCODE = 'P0001';
  END IF;
END $issue1054_preflight$;`;
// Checked after the unchanged historical DDL but before its atomic receipt.
export const ISSUE1054_POSTFLIGHT_SQL = String.raw`DO $issue1054_postflight$
DECLARE
  mismatches text;
BEGIN
  WITH expected(name, cols, fks, indexes) AS (VALUES
    ('employee_availability_rules',14,3,3),
    ('open_shifts',14,6,4),
    ('open_shift_claims',14,5,4)
  )
  SELECT pg_catalog.string_agg(e.name, ', ' ORDER BY e.name)
    INTO mismatches
  FROM expected e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
  LEFT JOIN pg_catalog.pg_class t
    ON t.relnamespace=n.oid AND t.relname=e.name AND t.relkind='r'
  WHERE t.oid IS NULL OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) <> e.cols OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint fk
      WHERE fk.conrelid=t.oid AND fk.contype='f' AND fk.convalidated) <> e.fks OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index ix
      WHERE ix.indrelid=t.oid AND ix.indisvalid AND ix.indisready) <> e.indexes;

  IF mismatches IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1054_POSTFLIGHT_INCOMPLETE_FINAL_SCHEMA: %',
      mismatches USING ERRCODE='P0001';
  END IF;
END $issue1054_postflight$;`;
