-- 0119: multi-entity extension; sensitive historical backfill: DBA-approved clone rehearsal required.
-- Additive, idempotent multi-entity v2 migration. Never run on production without
-- a DBA-approved applied-SHA journal, backup, clone rehearsal and evidence.
-- All new behavior is gated by MULTI_ENTITY_ENABLED (default off).
-- Reuses the existing 0045 legal_entities table and 0065 compliance scopes.
-- The reviewed forward-migration executor owns BEGIN/COMMIT and writes the
-- immutable applied journal inside that same transaction. Never execute this
-- sensitive historical-payroll backfill by hand or outside that executor.
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

ALTER TABLE legal_entities ADD COLUMN IF NOT EXISTS registered_address text;
CREATE UNIQUE INDEX IF NOT EXISTS legal_entities_org_id_unique ON legal_entities(organization_id, id);

ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payroll_jobs ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payout_transfers ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE bank_file_validations ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE historical_payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE year_end_adjustments ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- Immutable parent run is the authoritative historical employer.
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
CREATE TABLE IF NOT EXISTS user_legal_entity_grants (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_entity_grants_unique ON user_legal_entity_grants(organization_id,user_id,legal_entity_id);
CREATE INDEX IF NOT EXISTS user_entity_grants_user_idx ON user_legal_entity_grants(user_id,organization_id);

CREATE TABLE IF NOT EXISTS user_entity_preferences (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_entity_preferences_unique ON user_entity_preferences(organization_id,user_id);

CREATE TABLE IF NOT EXISTS employee_entity_assignments (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_entity_assignment_interval_check CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_entity_assignment_start_unique ON employee_entity_assignments(organization_id,employee_id,effective_from);
CREATE INDEX IF NOT EXISTS employee_entity_assignment_effective_idx ON employee_entity_assignments(organization_id,legal_entity_id,effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS employee_entity_one_open_unique ON employee_entity_assignments(organization_id,employee_id) WHERE effective_until IS NULL;

CREATE TABLE IF NOT EXISTS entity_transfer_requests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  from_legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  to_legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  reason varchar(400) NOT NULL,
  service_start_date date NOT NULL,
  leave_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  thirteenth_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  continuity_note text NOT NULL,
  requested_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_transfer_distinct_entity_check CHECK (from_legal_entity_id <> to_legal_entity_id),
  CONSTRAINT entity_transfer_maker_checker_check CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id),
  CONSTRAINT entity_transfer_status_check CHECK (status IN ('pending_approval','approved','rejected','applied','cancelled','blocked'))
);
CREATE INDEX IF NOT EXISTS entity_transfer_org_employee_idx ON entity_transfer_requests(organization_id,employee_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS entity_transfer_one_open_unique ON entity_transfer_requests(organization_id,employee_id) WHERE status IN ('pending_approval','approved');

-- Tenant consistency checks for NEW authorization and history data; safe on
-- re-execution, and do not trust unscoped numerical IDs from callers.
DO $checks$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_grants_tenant_entity_fk') THEN
   ALTER TABLE user_legal_entity_grants ADD CONSTRAINT user_entity_grants_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_pref_tenant_entity_fk') THEN
   ALTER TABLE user_entity_preferences ADD CONSTRAINT user_entity_pref_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignment_tenant_entity_fk') THEN
   ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_from_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_from_tenant_entity_fk
     FOREIGN KEY (organization_id, from_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_to_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_to_tenant_entity_fk
     FOREIGN KEY (organization_id, to_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
END $checks$;

-- Existing entity-scoped staff receive ONE conservative initial grant.
-- Group-wide owner/admin/bookkeeper are resolved at runtime, not here.
INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)
SELECT m.organization_id, m.user_id,
  COALESCE(u.legal_entity_id, le.id)
FROM user_organizations m
LEFT JOIN org_units u ON u.id = m.org_unit_id AND u.organization_id=m.organization_id
JOIN legal_entities le ON le.organization_id=m.organization_id AND le.primary_entity=true
WHERE m.active = true
  AND m.role IN ('hr','payroll','checker','manager')
ON CONFLICT DO NOTHING;

-- Preserve stable service date. If historical employer move events exist,
-- an exact historical interval backfill requires a reviewed attribution.
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
