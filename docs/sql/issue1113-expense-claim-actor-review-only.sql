-- Issue #1113: review-only additive recovery candidate for Drizzle app-read compatibility.
-- It is not a new numbered migration or an adoption receipt. Do NOT merge into production.
-- The separate original migration sequence MUST be independently reconciled by a DBA.
-- This file intentionally cannot execute until the isolated branch placeholder is
-- substituted by the authorized rehearsal runner (in memory, not in source).
-- Main source snapshot: a8b01b510ae6a742de01def64244b7615cb12fd1.
DO $pre$
BEGIN
  IF pg_catalog.current_database() <> 'neondb'
  OR pg_catalog.current_setting('neon.project_id',true) IS DISTINCT FROM 'calm-wave-70219564'
  OR pg_catalog.current_setting('neon.branch_id',true) IS DISTINCT FROM '__NEW_ISOLATED_NEON_BRANCH_ID__'
  OR pg_catalog.current_setting('neon.branch_id',true) IN ('br-lucky-sound-b79i56jw','br-green-hat-b77qj8fs')
  THEN RAISE EXCEPTION 'NOT_AUTHORIZED_ISOLATED_REHEARSAL_BRANCH'; END IF;
  IF to_regclass('public.expense_claims') IS NULL
  OR to_regclass('public.users') IS NULL
  THEN RAISE EXCEPTION 'EXPENSE_ACTOR_PARENT_TABLE_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.table_name='expense_claims'
              AND c.column_name='submitted_by_user_id')
  THEN RAISE EXCEPTION 'EXPENSE_ACTOR_COLUMN_EXISTS_REVIEW_DRIFT_BEFORE_REPLAY'; END IF;
  IF (SELECT count(*) FROM public.expense_claims)<>0
  THEN RAISE EXCEPTION 'EXPENSE_ACTOR_HISTORICAL_ROWS_REQUIRE_BACKFILL_REVIEW'; END IF;
END $pre$;

ALTER TABLE public.expense_claims ADD COLUMN submitted_by_user_id integer
  REFERENCES public.users(id) ON DELETE SET NULL;

DO $post$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns c
   WHERE c.table_schema='public' AND c.table_name='expense_claims'
     AND c.column_name='submitted_by_user_id' AND c.data_type='integer'
     AND c.is_nullable='YES'
 ) THEN RAISE EXCEPTION 'EXPENSE_ACTOR_COLUMN_DRIFT_POSTFLIGHT'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_constraint x JOIN pg_catalog.pg_class t
     ON t.oid=x.conrelid
   WHERE t.oid='public.expense_claims'::regclass AND x.contype='f'
     AND pg_catalog.pg_get_constraintdef(x.oid) LIKE '%submitted_by_user_id%'
     AND pg_catalog.pg_get_constraintdef(x.oid) LIKE '%users%'
 ) THEN RAISE EXCEPTION 'EXPENSE_ACTOR_FOREIGN_KEY_DRIFT_POSTFLIGHT'; END IF;
 IF (SELECT count(*) FROM public.expense_claims)<>0
 THEN RAISE EXCEPTION 'EXPENSE_ROWS_MODIFIED_UNEXPECTEDLY'; END IF;
END $post$;
