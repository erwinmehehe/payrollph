-- Read-only issue #1113 schema contract, captured from main at acf61b1714d73b18930a0ab30d0932860c66fb91.
-- Public catalog metadata only. DOES NOT access employee, payroll or salary rows.
-- Run against each Neon branch individually, never use db:push as a shortcut.
WITH
  expected_tables(table_name,source_path) AS (VALUES
  ('employee_worksite_assignments','docs/sql/issue1113-postcutover-schema-gapfill-REVIEW_ONLY.sql'),
  ('separation_records','docs/sql/issue1113-postcutover-schema-gapfill-REVIEW_ONLY.sql'),
  ('workforce_schedule_guardrail_policies','drizzle/0033_wfm_schedule_guardrails.sql'),
  ('workforce_attendance_lock_policies','drizzle/0087_wfm_attendance_cutoff_locks.sql'),
  ('workforce_attendance_period_locks','drizzle/0087_wfm_attendance_cutoff_locks.sql'),
  ('first_payroll_journey_progress','drizzle/0117_inline_first_payroll_journey.sql')
  ),
  expected_columns(table_name,column_name) AS (VALUES
  ('employee_worksite_assignments','id'),
  ('employee_worksite_assignments','organization_id'),
  ('employee_worksite_assignments','employee_id'),
  ('employee_worksite_assignments','worksite_id'),
  ('employee_worksite_assignments','decision'),
  ('employee_worksite_assignments','effective_from'),
  ('employee_worksite_assignments','effective_until'),
  ('employee_worksite_assignments','reason'),
  ('employee_worksite_assignments','created_by'),
  ('employee_worksite_assignments','created_at'),
  ('separation_records','id'),
  ('separation_records','organization_id'),
  ('separation_records','employee_id'),
  ('separation_records','separation_type'),
  ('separation_records','notice_date'),
  ('separation_records','last_day'),
  ('separation_records','clearance_status'),
  ('separation_records','it_cleared'),
  ('separation_records','admin_cleared'),
  ('separation_records','finance_cleared'),
  ('separation_records','hr_cleared'),
  ('separation_records','prorated_13th_month'),
  ('separation_records','thirteenth_entitlement'),
  ('separation_records','thirteenth_paid_ytd'),
  ('separation_records','basic_salary_earned_ytd'),
  ('separation_records','historical_basic_salary_earned'),
  ('separation_records','unpaid_basic_salary'),
  ('separation_records','unused_leave_credits'),
  ('separation_records','leave_monetization_pay'),
  ('separation_records','separation_pay'),
  ('separation_records','retirement_pay'),
  ('separation_records','other_benefits'),
  ('separation_records','tax_adjustment'),
  ('separation_records','final_statutory_deductions'),
  ('separation_records','loan_deductions'),
  ('separation_records','gross_final_pay'),
  ('separation_records','net_final_pay'),
  ('separation_records','final_pay_due_date'),
  ('separation_records','computation_snapshot'),
  ('separation_records','status'),
  ('separation_records','coe_issued'),
  ('separation_records','approved_at'),
  ('separation_records','released_at'),
  ('separation_records','release_reference'),
  ('separation_records','prepared_by_user_id'),
  ('separation_records','approved_by_user_id'),
  ('separation_records','released_by_user_id'),
  ('separation_records','created_at'),
  ('workforce_schedule_guardrail_policies','id'),
  ('workforce_schedule_guardrail_policies','organization_id'),
  ('workforce_schedule_guardrail_policies','minimum_rest_minutes'),
  ('workforce_schedule_guardrail_policies','max_consecutive_working_days'),
  ('workforce_schedule_guardrail_policies','rolling_seven_day_minutes'),
  ('workforce_schedule_guardrail_policies','enforcement_mode'),
  ('workforce_schedule_guardrail_policies','active'),
  ('workforce_schedule_guardrail_policies','updated_by'),
  ('workforce_schedule_guardrail_policies','created_at'),
  ('workforce_schedule_guardrail_policies','updated_at'),
  ('workforce_attendance_lock_policies','organization_id'),
  ('workforce_attendance_lock_policies','require_payroll_cutoff_lock'),
  ('workforce_attendance_lock_policies','updated_by'),
  ('workforce_attendance_lock_policies','updated_by_user_id'),
  ('workforce_attendance_lock_policies','created_at'),
  ('workforce_attendance_lock_policies','updated_at'),
  ('workforce_attendance_period_locks','id'),
  ('workforce_attendance_period_locks','organization_id'),
  ('workforce_attendance_period_locks','period_start'),
  ('workforce_attendance_period_locks','period_end'),
  ('workforce_attendance_period_locks','lock_type'),
  ('workforce_attendance_period_locks','status'),
  ('workforce_attendance_period_locks','reason'),
  ('workforce_attendance_period_locks','locked_by'),
  ('workforce_attendance_period_locks','locked_by_user_id'),
  ('workforce_attendance_period_locks','locked_at'),
  ('workforce_attendance_period_locks','unlocked_by'),
  ('workforce_attendance_period_locks','unlocked_by_user_id'),
  ('workforce_attendance_period_locks','unlock_reason'),
  ('workforce_attendance_period_locks','unlocked_at'),
  ('workforce_attendance_period_locks','created_at'),
  ('workforce_attendance_period_locks','updated_at'),
  ('first_payroll_journey_progress','organization_id'),
  ('first_payroll_journey_progress','step'),
  ('first_payroll_journey_progress','owner_role'),
  ('first_payroll_journey_progress','data'),
  ('first_payroll_journey_progress','updated_by_user_id'),
  ('first_payroll_journey_progress','updated_at')
  ),
  table_contract AS (
    SELECT 'table'::text AS object_type, t.table_name AS object_name, t.source_path,
      to_regclass('public.' || t.table_name) IS NOT NULL AS exists_on_branch
    FROM expected_tables t
  ),
  column_contract AS (
    SELECT 'column'::text AS object_type, c.table_name || '.' || c.column_name AS object_name,
      t.source_path,
      EXISTS (
        SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema='public'
          AND ic.table_name=c.table_name
          AND ic.column_name=c.column_name
      ) AS exists_on_branch
    FROM expected_columns c
    JOIN expected_tables t ON t.table_name=c.table_name
  )
SELECT object_type,object_name,source_path,exists_on_branch
FROM table_contract
UNION ALL
SELECT object_type,object_name,source_path,exists_on_branch FROM column_contract
ORDER BY object_type,object_name;
