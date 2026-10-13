-- ISSUE #910: REVIEW-ONLY SQL SOURCE EXTRACT. NO PRODUCTION, NEON OR STAGING EXECUTION.
-- Not a reviewed migration: this file is outside drizzle/ and is not a release input.
-- Do not infer applied receipts. DBA approval, protected clone, finance/legal attribution
-- review and explicitly managed rollback are required before any migration change.
-- Derived from main commit fdf2793d05e0f27372e2c8f22347879b1cf2034c.
-- BEGIN_SOURCE_0121_STAGE --
INSERT INTO legal_entities (
  organization_id, code, legal_name, display_name, bir_tin, bir_branch_code,
  sss_employer_no, philhealth_employer_no, pagibig_employer_no,
  statutory_deduction_timing, payroll_calendar_mode, primary_entity, active
)
SELECT o.id, 'PRIMARY', o.legal_name, o.name, o.bir_tin, o.bir_branch_code,
  o.sss_employer_no, o.philhealth_employer_no, o.pagibig_employer_no,
  o.statutory_deduction_timing, o.payroll_calendar_mode, true, true
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM legal_entities le WHERE le.organization_id = o.id)
ON CONFLICT DO NOTHING;
-- END_SOURCE_0121_STAGE --
