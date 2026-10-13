-- ISSUE #910: REVIEW-ONLY SQL SOURCE EXTRACT. NO PRODUCTION, NEON OR STAGING EXECUTION.
-- Not a reviewed migration: this file is outside drizzle/ and is not a release input.
-- Do not infer applied receipts. DBA approval, protected clone, finance/legal attribution
-- review and explicitly managed rollback are required before any migration change.
-- Derived from main commit fdf2793d05e0f27372e2c8f22347879b1cf2034c.
-- BEGIN_SOURCE_0121_STAGE --
INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from)
SELECT e.organization_id, e.id, e.legal_entity_id, e.start_date
FROM employees e
WHERE e.legal_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employee_entity_assignments a WHERE a.organization_id=e.organization_id AND a.employee_id=e.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM worker_employment_events h
    WHERE h.organization_id=e.organization_id AND h.employee_id=e.id
      AND h.from_legal_entity_id IS DISTINCT FROM h.to_legal_entity_id
      AND h.from_legal_entity_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM payroll_entries pe
    JOIN payroll_runs pr ON pr.id=pe.payroll_run_id
    WHERE pe.employee_id=e.id
      AND pr.organization_id=e.organization_id
      AND (pr.legal_entity_id IS NULL OR pr.legal_entity_id IS DISTINCT FROM e.legal_entity_id)
  )
ON CONFLICT DO NOTHING;
-- END_SOURCE_0121_STAGE --
