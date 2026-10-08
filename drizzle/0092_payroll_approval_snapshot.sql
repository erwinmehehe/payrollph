ALTER TABLE approval_tasks
  ADD COLUMN IF NOT EXISTS payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payroll_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS payroll_gross numeric(14,2),
  ADD COLUMN IF NOT EXISTS payroll_net numeric(14,2),
  ADD COLUMN IF NOT EXISTS payroll_employee_count integer;

-- Preserve the structural relationship for historical payroll tasks. Historical
-- approvals intentionally remain without a fingerprint and therefore fail
-- closed until the payroll is resubmitted for review.
UPDATE approval_tasks AS task
SET payroll_run_id = run.id
FROM payroll_runs AS run
WHERE task.payroll_run_id IS NULL
  AND task.organization_id = run.organization_id
  AND task.detail ~ 'Payroll run #[0-9]+'
  AND run.id = substring(task.detail from 'Payroll run #([0-9]+)')::integer;

CREATE INDEX IF NOT EXISTS approval_tasks_payroll_run_idx
  ON approval_tasks (organization_id, payroll_run_id, id);
