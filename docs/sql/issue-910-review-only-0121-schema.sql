-- ISSUE #910: REVIEW-ONLY SQL SOURCE EXTRACT. NO PRODUCTION, NEON OR STAGING EXECUTION.
-- Not a reviewed migration: this file is outside drizzle/ and is not a release input.
-- Do not infer applied receipts. DBA approval, protected clone, finance/legal attribution
-- review and explicitly managed rollback are required before any migration change.
-- Derived from main commit fdf2793d05e0f27372e2c8f22347879b1cf2034c.
-- BEGIN_SOURCE_0121_STAGE --
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
-- END_SOURCE_0121_STAGE --
