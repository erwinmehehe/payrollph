-- Issue #1015: candidate for an independently reviewed, FORWARD-ONLY repair.
-- SOURCE ONLY: not an applied migration, approval, historical receipt, or
-- authorization to enable real payroll/payout features.
--
-- Existing 0067 and 0088 are historic SQL and MUST NOT be silently replayed.
-- This candidate creates only the ABSENT final attendance exception relation.
-- It is blocked by the protected release runner until the DBA establishes:
--   (1) full historical path+SHA receipts and a protected cutover boundary,
--   (2) all preceding forward migration receipts (0123 and earlier),
--   (3) verified target and role, approved backup+offline restore, DBA review.
-- No application rows are read, updated, deleted, backfilled or copied.
-- No IF NOT EXISTS: an existing/drifted target requires independent review.
DO $issue1015_attendance_preflight$
DECLARE
  missing_or_invalid_parents text;
BEGIN
  IF pg_catalog.to_regclass('public.attendance_exception_events') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1015_EXISTING_ATTENDANCE_RELATION_REQUIRES_MANUAL_REVIEW'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.string_agg(required.name, ', ' ORDER BY required.name)
    INTO missing_or_invalid_parents
  FROM (VALUES
    ('organizations'), ('employees'), ('users'), ('time_punches')
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
     );

  IF missing_or_invalid_parents IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1015_PARENT_INTEGER_PK_MISSING_OR_DRIFTED: %',
      missing_or_invalid_parents USING ERRCODE = 'P0001';
  END IF;

  -- An interrupted historical DDL may leave the SERIAL sequence or a name
  -- reserved on a different table even when the target relation is absent.
  -- Refuse that partial namespace state BEFORE any new DDL is attempted.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class object
    JOIN pg_catalog.pg_namespace ns ON ns.oid = object.relnamespace
    WHERE ns.nspname = 'public'
      AND object.relname = ANY (ARRAY[
        'attendance_exception_events_id_seq',
        'attendance_exception_events_pkey',
        'attendance_exception_events_fingerprint_unique',
        'attendance_exception_events_open_idx',
        'attendance_exception_events_employee_idx',
        'attendance_exception_events_owner_idx',
        'attendance_exception_events_sla_idx'
      ])
  ) THEN
    RAISE EXCEPTION 'ISSUE1015_ORPHANED_ATTENDANCE_SCHEMA_OBJECT_REQUIRES_MANUAL_REVIEW'
      USING ERRCODE = 'P0001';
  END IF;
END
$issue1015_attendance_preflight$;

CREATE TABLE public.attendance_exception_events (
  id serial PRIMARY KEY NOT NULL,
  organization_id integer NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  exception_kind varchar(40) NOT NULL,
  severity varchar(16) NOT NULL,
  punch_id integer REFERENCES public.time_punches(id) ON DELETE SET NULL,
  minutes integer,
  message text NOT NULL,
  fingerprint_sha256 varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  owner_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  owner_name varchar(120),
  sla_due_at timestamptz,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  resolved_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_by_name varchar(120),
  resolution_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_exception_events_severity_check
    CHECK (severity IN ('info', 'warning', 'blocker')),
  CONSTRAINT attendance_exception_events_status_check
    CHECK (status IN ('open', 'resolved'))
);

CREATE UNIQUE INDEX attendance_exception_events_fingerprint_unique
  ON public.attendance_exception_events
    (organization_id, employee_id, work_date, fingerprint_sha256);
CREATE INDEX attendance_exception_events_open_idx
  ON public.attendance_exception_events
    (organization_id, status, work_date, employee_id);
CREATE INDEX attendance_exception_events_employee_idx
  ON public.attendance_exception_events
    (organization_id, employee_id, work_date);
CREATE INDEX attendance_exception_events_owner_idx
  ON public.attendance_exception_events
    (organization_id, status, owner_user_id, sla_due_at);
CREATE INDEX attendance_exception_events_sla_idx
  ON public.attendance_exception_events
    (organization_id, status, sla_due_at);

-- This catalog-only assertion executes IN THE SAME TRANSACTION as the
-- table creation and the protected runner's forward-migration journal insert.
-- Catch incomplete DDL before a committed journal entry could claim success.
-- A separate, independent 36-object read-only postflight is still mandatory.
DO $issue1015_attendance_postflight$
DECLARE
  target_oid oid := pg_catalog.to_regclass('public.attendance_exception_events');
  column_count integer;
  named_index_count integer;
  foreign_key_count integer;
  named_check_count integer;
  primary_key_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO column_count
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = target_oid AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT pg_catalog.count(*) INTO named_index_count
  FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class idx ON idx.oid = ix.indexrelid
  WHERE ix.indrelid = target_oid AND ix.indisvalid AND ix.indisready
    AND (
      (idx.relname = 'attendance_exception_events_fingerprint_unique' AND ix.indisunique)
      OR (idx.relname = ANY (ARRAY[
        'attendance_exception_events_open_idx',
        'attendance_exception_events_employee_idx',
        'attendance_exception_events_owner_idx',
        'attendance_exception_events_sla_idx'
      ]) AND NOT ix.indisunique)
    );

  SELECT pg_catalog.count(*) INTO foreign_key_count
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = target_oid AND c.contype = 'f' AND c.convalidated;

  SELECT pg_catalog.count(*) INTO named_check_count
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = target_oid AND c.contype = 'c' AND c.convalidated
    AND c.conname = ANY (ARRAY[
      'attendance_exception_events_severity_check',
      'attendance_exception_events_status_check'
    ]);

  SELECT pg_catalog.count(*) INTO primary_key_count
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = target_oid AND c.contype = 'p' AND c.convalidated;

  IF target_oid IS NULL
     OR column_count <> 23 OR named_index_count <> 5
     OR foreign_key_count <> 5 OR named_check_count <> 2
     OR primary_key_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE1015_POSTFLIGHT_SCHEMA_INCOMPLETE'
      USING ERRCODE = 'P0001';
  END IF;
END
$issue1015_attendance_postflight$;

-- The protected release runner must atomically journal the exact path and SHA
-- with this DDL. Full 36/36 read-only parity and independent DBA sign-off
-- remain separate release requirements. No CI result grants rollout approval.
