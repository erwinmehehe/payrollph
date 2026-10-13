-- ISSUE #910: REVIEW-ONLY SQL SOURCE EXTRACT. NO PRODUCTION, NEON OR STAGING EXECUTION.
-- Not a reviewed migration: this file is outside drizzle/ and is not a release input.
-- Do not infer applied receipts. DBA approval, protected clone, finance/legal attribution
-- review and explicitly managed rollback are required before any migration change.
-- Derived from main commit fdf2793d05e0f27372e2c8f22347879b1cf2034c.
-- BEGIN_SOURCE_0121_STAGE --
UPDATE payroll_entries e SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE e.payroll_run_id = r.id AND e.legal_entity_id IS NULL;
UPDATE payslips p SET legal_entity_id = r.legal_entity_id
FROM payroll_entries e JOIN payroll_runs r ON r.id = e.payroll_run_id
WHERE p.payroll_entry_id = e.id AND p.legal_entity_id IS NULL;
UPDATE payroll_jobs j SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE j.payroll_run_id = r.id AND j.legal_entity_id IS NULL;
UPDATE payout_batches b SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE b.payroll_run_id = r.id AND b.legal_entity_id IS NULL;
UPDATE payout_transfers t SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE t.payroll_run_id = r.id AND t.legal_entity_id IS NULL;
UPDATE bank_file_validations v SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE v.payroll_run_id = r.id AND v.legal_entity_id IS NULL;
UPDATE year_end_adjustments y SET legal_entity_id = r.legal_entity_id
FROM payroll_runs r WHERE y.payroll_run_id = r.id AND y.legal_entity_id IS NULL;

-- The employee's CURRENT company is NOT evidence of historical ownership.
-- Imported history, unlinked year-end/separation evidence and unlinked bank
-- files remain nullable until verified; downstream filings must fail closed.
-- END_SOURCE_0121_STAGE --
