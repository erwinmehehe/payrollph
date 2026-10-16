-- ISSUE #1113: REVIEW-ONLY SOURCE CANDIDATE; NOT AN APPROVED RELEASE MIGRATION.
-- Never run on Neon main / br-lucky-sound-b79i56jw or the existing active QA branch.
-- THIS FILE INTENTIONALLY REQUIRES REPLACING __NEW_ISOLATED_NEON_BRANCH_ID__.
-- A new Neon branch could NOT be created on 2026-10-16 (10/10 branch limit).
-- No historical migration journal/cutover verified. DO NOT invent receipts or
-- assume drizzle files are independently replayable or a numbered sequence.
--
-- Historical prerequisites owned by their ORIGINAL source migrations:
--   drizzle/0033_wfm_schedule_guardrails.sql
--   drizzle/0087_wfm_attendance_cutoff_locks.sql
--   drizzle/0102_final_pay_maker_checker.sql
--   drizzle/0117_inline_first_payroll_journey.sql
-- Verify independently approved historical reconciliation before any runner
-- adoption. The 15 separation columns and worksite decision below are
-- the additive delta under review, NOT a substitute for the historic files.
-- WARNING: zero rows required in separation_records: defaults must never
-- assert arbitrary historical statutory/final-pay balances for real exits.
-- All SQL is intended to execute atomically in the reviewed migration runner.
--
DO $issue1113_preflight$
DECLARE absent text;
BEGIN
  IF current_database() <> 'neondb'
    OR current_setting('neon.project_id', true) IS DISTINCT FROM 'calm-wave-70219564'
    OR current_setting('neon.branch_id', true) IS DISTINCT FROM '__NEW_ISOLATED_NEON_BRANCH_ID__'
    OR current_setting('neon.branch_id', true) IN ('br-lucky-sound-b79i56jw', 'br-green-hat-b77qj8fs')
  THEN
    RAISE EXCEPTION 'ISSUE1113_REHEARSAL_BRANCH_ONLY: fail-closed database identity';
  END IF;
  SELECT string_agg(x.table_name, ', ' ORDER BY x.table_name) INTO absent
  FROM (VALUES
    ('organizations'),('users'),('separation_records'),
    ('employee_worksite_assignments'),('workforce_schedule_guardrail_policies'),
    ('workforce_attendance_lock_policies'),('workforce_attendance_period_locks'),
    ('first_payroll_journey_progress')
  ) x(table_name)
  WHERE to_regclass('public.' || x.table_name) IS NULL;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1113_HISTORIC_RECEIPTS_PREREQUISITES_MISSING: %', absent;
  END IF;
  IF (SELECT count(*) FROM public.separation_records) <> 0 THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_ROWS_NEED_DBA_AMOUNT_RECONCILIATION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_worksite_assignments
    WHERE effective_until IS NOT NULL AND effective_until < effective_from
  ) THEN
    RAISE EXCEPTION 'ISSUE1113_EXISTING_WORKSITE_WINDOW_INVALID';
  END IF;
END
$issue1113_preflight$;

-- Main schema.ts employeeWorksiteAssignments, matches QA-tested behavior:
--   legacy assignments represent allow decisions; no row deletion/backfill.
ALTER TABLE public.employee_worksite_assignments
  ADD COLUMN IF NOT EXISTS decision varchar(8) NOT NULL DEFAULT 'allow';

-- Main schema.ts separationRecords; these columns are missing from original.
-- Do NOT duplicate the three actor FK columns owned by historical 0102.
ALTER TABLE public.separation_records
  ADD COLUMN IF NOT EXISTS thirteenth_entitlement numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thirteenth_paid_ytd numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS basic_salary_earned_ytd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS historical_basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS separation_pay numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retirement_pay numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_benefits numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_statutory_deductions numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_final_pay numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_pay_due_date date,
  ADD COLUMN IF NOT EXISTS computation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_reference varchar(160);

-- Strict structural postflight (do not treat IF NOT EXISTS as shape proof).
DO $issue1113_postflight$
DECLARE
  absent text;
  bad text;
BEGIN
  SELECT string_agg(e.table_name || '.' || e.column_name, ', ' ORDER BY e.table_name, e.column_name)
  INTO absent
  FROM (VALUES
    ('employee_worksite_assignments','decision'),
    ('separation_records','thirteenth_entitlement'),
    ('separation_records','thirteenth_paid_ytd'),
    ('separation_records','basic_salary_earned_ytd'),
    ('separation_records','historical_basic_salary_earned'),
    ('separation_records','unpaid_basic_salary'),
    ('separation_records','separation_pay'),
    ('separation_records','retirement_pay'),
    ('separation_records','other_benefits'),
    ('separation_records','final_statutory_deductions'),
    ('separation_records','gross_final_pay'),
    ('separation_records','final_pay_due_date'),
    ('separation_records','computation_snapshot'),
    ('separation_records','approved_at'),
    ('separation_records','released_at'),
    ('separation_records','release_reference'),
    ('separation_records','prepared_by_user_id'),
    ('separation_records','approved_by_user_id'),
    ('separation_records','released_by_user_id')
  ) e(table_name,column_name)
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
  WHERE c.column_name IS NULL;
  IF absent IS NOT NULL THEN RAISE EXCEPTION 'ISSUE1113_POSTFLIGHT_MISSING_COLUMNS: %', absent; END IF;

  SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name,c.column_name)
  INTO bad
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND (
    (c.table_name='employee_worksite_assignments' AND c.column_name='decision'
      AND (c.data_type<>'character varying' OR c.character_maximum_length<>8
           OR c.is_nullable<>'NO' OR COALESCE(c.column_default, '') NOT LIKE '%allow%'))
    OR (c.table_name='separation_records' AND c.column_name IN (
         'thirteenth_entitlement','thirteenth_paid_ytd','unpaid_basic_salary',
         'separation_pay','retirement_pay','other_benefits','final_statutory_deductions','gross_final_pay'
       ) AND (c.data_type<>'numeric' OR c.numeric_precision<>12 OR c.numeric_scale<>2 OR c.is_nullable<>'NO'))
    OR (c.table_name='separation_records' AND c.column_name IN (
         'basic_salary_earned_ytd','historical_basic_salary_earned'
       ) AND (c.data_type<>'numeric' OR c.numeric_precision<>14 OR c.numeric_scale<>2 OR c.is_nullable<>'NO'))
  );
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'ISSUE1113_POSTFLIGHT_TYPE_OR_DEFAULT_DRIFT: %', bad; END IF;
  IF (SELECT count(*) FROM public.separation_records) <> 0 THEN
    RAISE EXCEPTION 'ISSUE1113_POSTFLIGHT_UNEXPECTED_SEPARATION_MUTATION';
  END IF;
END
$issue1113_postflight$;
