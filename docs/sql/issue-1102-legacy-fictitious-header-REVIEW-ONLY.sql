-- #1102: HUMAN-REVIEWED MANUAL OPERATOR HANDOFF. NEVER AUTO-RUN IN CI.
-- Repository file is intentionally NOT a migration, seed or service startup path.
-- Target: the existing FICTIONAL Loom & Local public demo rows ONLY.
-- Neon project calm-wave-70219564 | branch br-lucky-sound-b79i56jw
-- Database neondb | endpoint ep-cool-hat-b7e7gpoo.
--
-- IMPORTANT: THE LAST COMMAND IS ROLLBACK. This file is DRY RUN by default.
-- An approved operator may separately replace that last ROLLBACK with COMMIT
-- only after independently checking the exact current branch/endpoint, source
-- values, recovery receipt, absence of customer data and UI implications.
-- If any assertion fails, PostgreSQL aborts the transaction; issue ROLLBACK.
-- Do not restore or promote a Neon snapshot (prior #899 endpoint incident).
-- No provider, bank, filing, payroll calculation or worker row is modified.
-- Refuse linked payroll/bank/provider/approval/adjustment/attendance evidence,
-- including prepared payouts and underpayment requests. The operator must
-- also stop concurrent demo writes and independently verify runtime identity.
--
-- Before-values stored in #1102:
-- run 1 gross 176300.00/net 145645.00 -> 181300.00/147400.00
-- run 2 gross 181250.00/net 149768.00 -> 182800.00/148600.00
-- run 3 gross 183400.00/net 151524.00 -> 184300.00/149800.00

BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='4000ms';
SET LOCAL statement_timeout='20000ms';

CREATE TEMP TABLE issue1102_expected (
 run_id integer PRIMARY KEY,
 run_status text NOT NULL,
 period_label text NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL,
 pay_date date NOT NULL,
 exceptions integer NOT NULL,
 old_gross numeric(18,2) NOT NULL,
 old_net numeric(18,2) NOT NULL,
 new_gross numeric(18,2) NOT NULL,
 new_net numeric(18,2) NOT NULL,
 before_row_md5 text NOT NULL
) ON COMMIT DROP;

INSERT INTO issue1102_expected VALUES
 (1,'Released','Aug 16–31, 2026','2026-08-16','2026-08-31','2026-09-05',0,176300.00,145645.00,181300.00,147400.00,'ff19c0614e6c7a840dcded961b8d8fbe'),
 (2,'Pending approval','Sep 1–15, 2026','2026-09-01','2026-09-15','2026-09-18',0,181250.00,149768.00,182800.00,148600.00,'42a9c09537efaf55480d47c3cd71fc93'),
 (3,'Needs review','Sep 16–30, 2026','2026-09-16','2026-09-30','2026-10-05',2,183400.00,151524.00,184300.00,149800.00,'12a911dd1d4f0f9dbe844377b26fb561');

DO $issue1102$
DECLARE
 n integer;
 changed integer;
 dependency record;
 linked boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('payrollph-issue-1102-fictitious-historical-header-correction'));

 -- Hard stop for an unexpected branch, database, or endpoint.
 IF current_database() IS DISTINCT FROM 'neondb'
   OR current_setting('neon.project_id',true) IS DISTINCT FROM 'calm-wave-70219564'
   OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'
   OR current_setting('neon.endpoint_id',true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'
 THEN RAISE EXCEPTION 'ISSUE1102_WRONG_DATABASE_PROJECT_BRANCH_OR_ENDPOINT'; END IF;

 -- This exact branch was confirmed to hold only one fictional tenant.
 IF (SELECT count(*) FROM public.organizations)<>1
   OR (SELECT count(*) FROM public.organizations WHERE id=1 AND name='Loom & Local')<>1
   OR (SELECT count(*) FROM public.employees WHERE organization_id=1)<>8
   OR (SELECT count(*) FROM public.payroll_runs)<>3
   OR (SELECT count(*) FROM public.payroll_entries)<>18
   OR (SELECT count(*) FROM issue1102_expected)<>3
 THEN RAISE EXCEPTION 'ISSUE1102_NOT_THE_EXACT_FICTIONAL_DEMO_SCOPE'; END IF;

 -- Lock only the anticipated fictional organization, workers, runs and details.
 PERFORM id FROM public.organizations WHERE id=1 FOR SHARE;
 PERFORM id FROM public.employees WHERE organization_id=1 ORDER BY id FOR SHARE;
 PERFORM id FROM public.payroll_runs WHERE id IN(1,2,3) AND organization_id=1 ORDER BY id FOR UPDATE;
 PERFORM id FROM public.payroll_entries WHERE payroll_run_id IN(1,2,3) ORDER BY id FOR SHARE;

 -- Never alter paid, approved, exported, filed or externally dependent runs.
 IF EXISTS(SELECT 1 FROM public.approval_tasks WHERE payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.bank_file_validations WHERE payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.government_filing_validations WHERE payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.managed_payroll_run_approvals WHERE payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.payroll_jobs WHERE payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.employee_pay_retro_adjustments
     WHERE source_payroll_run_id IN(1,2,3) OR settled_payroll_run_id IN(1,2,3))
   OR EXISTS(SELECT 1 FROM public.payslips
     WHERE payroll_entry_id IN (SELECT id FROM public.payroll_entries WHERE payroll_run_id IN(1,2,3)))
 THEN RAISE EXCEPTION 'ISSUE1102_RUN_HAS_CONNECTED_PAYROLL_OR_FINANCIAL_EVIDENCE'; END IF;

 -- These later-generation tables may be absent on the pinned legacy target.
 -- Existing relations are locked before querying; malformed schemas still fail closed.
 FOR dependency IN SELECT * FROM (VALUES
   ('payout_batches','SELECT EXISTS(SELECT 1 FROM public.payout_batches WHERE payroll_run_id IN(1,2,3))'),
   ('payout_transfers','SELECT EXISTS(SELECT 1 FROM public.payout_transfers WHERE payroll_run_id IN(1,2,3))'),
   ('provider_events','SELECT EXISTS(SELECT 1 FROM public.provider_events WHERE payroll_run_id IN(1,2,3))'),
   ('payroll_underpayment_requests','SELECT EXISTS(SELECT 1 FROM public.payroll_underpayment_requests WHERE source_payroll_run_id IN(1,2,3))'),
   ('year_end_adjustments','SELECT EXISTS(SELECT 1 FROM public.year_end_adjustments WHERE payroll_run_id IN(1,2,3))'),
   ('supplementary_earnings','SELECT EXISTS(SELECT 1 FROM public.supplementary_earnings WHERE payroll_run_id IN(1,2,3))'),
   ('expense_claims','SELECT EXISTS(SELECT 1 FROM public.expense_claims WHERE payroll_run_id IN(1,2,3))'),
   ('earned_wage_requests','SELECT EXISTS(SELECT 1 FROM public.earned_wage_requests WHERE payroll_run_id IN(1,2,3))'),
   ('loan_payments','SELECT EXISTS(SELECT 1 FROM public.loan_payments WHERE payroll_run_id IN(1,2,3))'),
   ('leave_conversions','SELECT EXISTS(SELECT 1 FROM public.leave_conversions WHERE payroll_run_id IN(1,2,3))'),
   ('workforce_timesheet_expectations','SELECT EXISTS(SELECT 1 FROM public.workforce_timesheet_expectations WHERE payroll_run_id IN(1,2,3))'),
   ('attendance_correction_requests','SELECT EXISTS(SELECT 1 FROM public.attendance_correction_requests WHERE invalidated_payroll_run_ids @> ''[1]''::jsonb OR invalidated_payroll_run_ids @> ''[2]''::jsonb OR invalidated_payroll_run_ids @> ''[3]''::jsonb)')
 ) AS checks(table_name,query_sql)
 LOOP
   IF to_regclass('public.' || dependency.table_name) IS NOT NULL THEN
     EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',dependency.table_name);
     EXECUTE dependency.query_sql INTO linked;
     IF linked THEN
       RAISE EXCEPTION 'ISSUE1102_RUN_HAS_CONNECTED_PAYROLL_OR_FINANCIAL_EVIDENCE';
     END IF;
   END IF;
 END LOOP;

 -- Immutable non-header before-image witnesses (change detection, not secrecy).
 IF (SELECT md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY e.id),''))
     FROM public.payroll_entries e) <> '1e19bf4a0bc4b0717b7be848945abc2e'
   OR (SELECT md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY e.id),''))
     FROM public.employees e) <> '3d061f144881d46c8ef4fba3d258ec78'
   OR (SELECT md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY e.id),''))
     FROM public.audit_events e) <> '2702a91b7425e5dd5164056c743420fd'
   OR (SELECT md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY e.id),''))
     FROM public.organizations e) <> '906294baa0f4469a704bd60b465677dd'
 THEN RAISE EXCEPTION 'ISSUE1102_NON_HEADER_DATA_CHANGED_SINCE_REVIEW'; END IF;

 -- Every known historical header, period, state and entire row must match.
 SELECT count(*)::integer INTO n
 FROM issue1102_expected x
 JOIN public.payroll_runs r ON r.id=x.run_id AND r.organization_id=1
 WHERE r.status=x.run_status AND r.period_label=x.period_label
   AND r.period_start=x.period_start AND r.period_end=x.period_end
   AND r.pay_date=x.pay_date AND r.employee_count=6
   AND r.exceptions=x.exceptions AND r.rule_version='PH-2026.01'
   AND r.gross_pay=x.old_gross AND r.net_pay=x.old_net
   AND md5(row_to_json(r)::text)=x.before_row_md5;
 IF n<>3 THEN RAISE EXCEPTION 'ISSUE1102_STALE_HEADER_OR_FULL_ROW_BEFORE_IMAGE'; END IF;

 -- Independent employee-entry totals, roster tenancy and exact money math.
 SELECT count(*)::integer INTO n
 FROM issue1102_expected x
 JOIN public.payroll_runs r ON r.id=x.run_id AND r.organization_id=1
 JOIN LATERAL (
   SELECT count(*)::int AS detail_count,
     count(DISTINCT e.employee_id)::int AS distinct_workers,
     coalesce(sum(e.gross_pay),0)::numeric(18,2) AS detail_gross,
     coalesce(sum(e.net_pay),0)::numeric(18,2) AS detail_net,
     count(*) FILTER(WHERE e.gross_pay-e.deductions<>e.net_pay
       OR w.id IS NULL OR w.organization_id<>1)::int AS invalid_entries
   FROM public.payroll_entries e
   LEFT JOIN public.employees w ON w.id=e.employee_id
   WHERE e.payroll_run_id=r.id
 ) a ON true
 WHERE a.detail_count=6 AND a.distinct_workers=6 AND a.invalid_entries=0
   AND a.detail_gross=x.new_gross AND a.detail_net=x.new_net;
 IF n<>3 THEN RAISE EXCEPTION 'ISSUE1102_SIX_EMPLOYEE_AGGREGATES_CHANGED'; END IF;

 -- EXACTLY two columns (gross_pay and net_pay) on exactly THREE rows.
 UPDATE public.payroll_runs r
 SET gross_pay=x.new_gross, net_pay=x.new_net
 FROM issue1102_expected x
 WHERE r.id=x.run_id AND r.organization_id=1
   AND r.status=x.run_status AND r.period_label=x.period_label
   AND r.period_start=x.period_start AND r.period_end=x.period_end
   AND r.pay_date=x.pay_date AND r.employee_count=6
   AND r.exceptions=x.exceptions AND r.rule_version='PH-2026.01'
   AND r.gross_pay=x.old_gross AND r.net_pay=x.old_net;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>3 THEN RAISE EXCEPTION 'ISSUE1102_NOT_EXACTLY_THREE_UPDATED_ROWS'; END IF;

 -- Fail closed if totals after UPDATE do not exactly equal employee entries.
 SELECT count(*)::integer INTO n
 FROM issue1102_expected x
 JOIN public.payroll_runs r ON r.id=x.run_id AND r.organization_id=1
 WHERE r.gross_pay=x.new_gross AND r.net_pay=x.new_net
   AND r.employee_count=6 AND r.status=x.run_status
   AND r.period_label=x.period_label AND r.period_start=x.period_start
   AND r.period_end=x.period_end AND r.pay_date=x.pay_date
   AND r.exceptions=x.exceptions AND r.rule_version='PH-2026.01'
   AND (SELECT sum(e.gross_pay) FROM public.payroll_entries e WHERE e.payroll_run_id=r.id)=r.gross_pay
   AND (SELECT sum(e.net_pay) FROM public.payroll_entries e WHERE e.payroll_run_id=r.id)=r.net_pay;
 IF n<>3 THEN RAISE EXCEPTION 'ISSUE1102_POST_UPDATE_TOTALS_FAILED'; END IF;

 RAISE NOTICE 'ISSUE1102_DRY_RUN_PASSED_3_FICTIONAL_HEADER_PAIRS';
END
$issue1102$;

-- Review the three proposed totals INSIDE the still-uncommitted transaction.
SELECT r.id,r.status,r.period_label,
       r.gross_pay::numeric(18,2)::text AS proposed_gross,
       r.net_pay::numeric(18,2)::text AS proposed_net,
       count(e.id)::int AS detail_count,
       sum(e.gross_pay)::numeric(18,2)::text AS detail_gross,
       sum(e.net_pay)::numeric(18,2)::text AS detail_net
FROM public.payroll_runs r
LEFT JOIN public.payroll_entries e ON e.payroll_run_id=r.id
WHERE r.organization_id=1 AND r.id IN (1,2,3)
GROUP BY r.id
ORDER BY r.id;

-- STOP / DRY RUN DEFAULT: the following statement discards all changes.
-- ONLY an independently authorized operator may manually change this to COMMIT
-- after satisfying the runbook's exact-target, recovery and audit conditions.
ROLLBACK;
