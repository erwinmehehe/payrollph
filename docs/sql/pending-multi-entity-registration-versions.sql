-- #1031 / 2026-10-17: current-schema source-only review reconciliation.
-- These are unnumbered proposals, NOT applied migrations or DBA approval.
-- SOURCE ONLY / DBA REVIEW REQUIRED. Not numbered or released to Neon.
-- Assign the next contiguous migration prefix ONLY after the canonical 0121
-- preflight and pending overlapping 0122+ drafts have been reconciled.
-- Never replay 0045/0065 or manufacture historical receipts.
-- All changes additive, idempotent; no historical identity backfill.
-- New encrypted proposal records and approved employer snapshots are only
-- enabled behind MULTI_ENTITY_ENABLED and MULTI_ENTITY_REGISTRATIONS_ENABLED.

CREATE UNIQUE INDEX IF NOT EXISTS employee_org_id_for_entity_scope
  ON employees (organization_id, id);

CREATE TABLE IF NOT EXISTS legal_entity_statutory_registrations (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT "legal_entity_statutory_registrations_organization_id_organizati" REFERENCES "organizations"("id") ON DELETE CASCADE,
  legal_entity_id integer NOT NULL CONSTRAINT "legal_entity_statutory_registrations_legal_entity_id_legal_enti" REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  revision integer NOT NULL,
  effective_date date NOT NULL,
  profile_envelope text NOT NULL,
  approved_by_user_id integer NOT NULL CONSTRAINT "legal_entity_statutory_registrations_approved_by_user_id_users_" REFERENCES "users"("id") ON DELETE RESTRICT,
  source_change_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_registration_revision_unique
  ON legal_entity_statutory_registrations(organization_id, legal_entity_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_registration_change_unique
  ON legal_entity_statutory_registrations(source_change_id);
CREATE INDEX IF NOT EXISTS legal_entity_registration_history_idx
  ON legal_entity_statutory_registrations(organization_id, legal_entity_id, effective_date);

CREATE TABLE IF NOT EXISTS legal_entity_profile_change_requests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT "legal_entity_profile_change_requests_organization_id_organizati" REFERENCES "organizations"("id") ON DELETE CASCADE,
  legal_entity_id integer NOT NULL CONSTRAINT "legal_entity_profile_change_requests_legal_entity_id_legal_enti" REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  expected_entity_updated_at timestamptz NOT NULL,
  effective_date date NOT NULL,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_envelope text NOT NULL,
  reason varchar(400) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  requested_by_user_id integer NOT NULL CONSTRAINT "legal_entity_profile_change_requests_requested_by_user_id_users" REFERENCES "users"("id") ON DELETE RESTRICT,
  decided_by_user_id integer CONSTRAINT "legal_entity_profile_change_requests_decided_by_user_id_users_i" REFERENCES "users"("id") ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entity_profile_status_check
    CHECK (status IN ('pending_approval','approved','rejected')),
  CONSTRAINT legal_entity_profile_maker_checker_check
    CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_profile_one_pending_unique
  ON legal_entity_profile_change_requests(organization_id, legal_entity_id)
  WHERE status='pending_approval';
CREATE INDEX IF NOT EXISTS legal_entity_profile_request_idx
  ON legal_entity_profile_change_requests(organization_id, legal_entity_id, status);

CREATE TABLE IF NOT EXISTS employee_entity_bank_accounts (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT "employee_entity_bank_accounts_organization_id_organizations_id_" REFERENCES "organizations"("id") ON DELETE CASCADE,
  employee_id integer NOT NULL CONSTRAINT "employee_entity_bank_accounts_employee_id_employees_id_fk" REFERENCES "employees"("id") ON DELETE RESTRICT,
  legal_entity_id integer NOT NULL CONSTRAINT "employee_entity_bank_accounts_legal_entity_id_legal_entities_id" REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  bank_code varchar(32) NOT NULL,
  account_name varchar(160) NOT NULL,
  account_envelope text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  approved_by_user_id integer CONSTRAINT "employee_entity_bank_accounts_approved_by_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_entity_bank_dates_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_entity_bank_one_current_unique
  ON employee_entity_bank_accounts(organization_id, employee_id, legal_entity_id)
  WHERE effective_until IS NULL;

CREATE TABLE IF NOT EXISTS legal_entity_transfer_liability_evidence (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT "legal_entity_transfer_liability_evidence_organization_id_organi" REFERENCES "organizations"("id") ON DELETE CASCADE,
  employee_id integer NOT NULL CONSTRAINT "legal_entity_transfer_liability_evidence_employee_id_employees_" REFERENCES "employees"("id") ON DELETE RESTRICT,
  transfer_request_id integer NOT NULL CONSTRAINT "legal_entity_transfer_liability_evidence_transfer_request_id_en" REFERENCES "entity_transfer_requests"("id") ON DELETE RESTRICT,
  from_legal_entity_id integer NOT NULL CONSTRAINT "legal_entity_transfer_liability_evidence_from_legal_entity_id_l" REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  to_legal_entity_id integer NOT NULL CONSTRAINT "legal_entity_transfer_liability_evidence_to_legal_entity_id_leg" REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  review_state varchar(24) NOT NULL DEFAULT 'unresolved',
  reviewed_liability_envelope text,
  reviewed_by_user_id integer CONSTRAINT "legal_entity_transfer_liability_evidence_reviewed_by_user_id_us" REFERENCES "users"("id") ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entity_transfer_liability_state_check
    CHECK (review_state IN ('unresolved','reviewed','rejected')),
  CONSTRAINT legal_entity_transfer_liability_review_evidence_check
    CHECK (review_state <> 'reviewed' OR
      (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
       AND reviewed_liability_envelope IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_entity_transfer_liability_unique
  ON legal_entity_transfer_liability_evidence(organization_id, transfer_request_id);

-- Immutable child evidence must match the exact authenticated parent
-- tenant, employer, employee and (for transfers) BOTH legal employers.
-- A standalone numeric source_change_id/transfer_request_id FK is insufficient.
ALTER TABLE legal_entity_profile_change_requests
  ADD CONSTRAINT entity_profile_request_scope_reference_unique
  UNIQUE (organization_id, legal_entity_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS entity_transfer_scope_reference_unique
  ON entity_transfer_requests(
    organization_id, id, employee_id, from_legal_entity_id, to_legal_entity_id);

-- Composite tenant-bound references guard against unsafe numeric foreign IDs.
DO $entity_composite$
BEGIN
  -- 0121 declares these assignment/transfer pairs but did not enforce
  -- employee tenant consistency; historical cross-tenant references fail
  -- closed during this unnumbered review migration.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignment_employee_tenant_fk') THEN
    ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_employee_tenant_fk
      FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_employee_tenant_fk') THEN
    ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_employee_tenant_fk
      FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_versions_tenant_fk') THEN
    ALTER TABLE legal_entity_statutory_registrations ADD CONSTRAINT entity_versions_tenant_fk
      FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_registration_source_request_fk') THEN
    ALTER TABLE legal_entity_statutory_registrations ADD CONSTRAINT entity_registration_source_request_fk
      FOREIGN KEY (organization_id, legal_entity_id, source_change_id)
      REFERENCES legal_entity_profile_change_requests(organization_id, legal_entity_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_profile_requests_tenant_fk') THEN
    ALTER TABLE legal_entity_profile_change_requests ADD CONSTRAINT entity_profile_requests_tenant_fk
      FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_employee_bank_tenant_fk') THEN
    ALTER TABLE employee_entity_bank_accounts ADD CONSTRAINT entity_employee_bank_tenant_fk
      FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_employee_bank_person_tenant_fk') THEN
    ALTER TABLE employee_entity_bank_accounts ADD CONSTRAINT entity_employee_bank_person_tenant_fk
      FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_transfer_liability_source_tenant_fk') THEN
    ALTER TABLE legal_entity_transfer_liability_evidence ADD CONSTRAINT entity_transfer_liability_source_tenant_fk
      FOREIGN KEY (organization_id, from_legal_entity_id) REFERENCES legal_entities(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_transfer_liability_target_tenant_fk') THEN
    ALTER TABLE legal_entity_transfer_liability_evidence ADD CONSTRAINT entity_transfer_liability_target_tenant_fk
      FOREIGN KEY (organization_id, to_legal_entity_id) REFERENCES legal_entities(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_transfer_liability_person_tenant_fk') THEN
    ALTER TABLE legal_entity_transfer_liability_evidence ADD CONSTRAINT entity_transfer_liability_person_tenant_fk
      FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entity_transfer_liability_approved_source_fk') THEN
    ALTER TABLE legal_entity_transfer_liability_evidence ADD CONSTRAINT entity_transfer_liability_approved_source_fk
      FOREIGN KEY (organization_id, transfer_request_id, employee_id,
        from_legal_entity_id, to_legal_entity_id)
      REFERENCES entity_transfer_requests(organization_id, id, employee_id,
        from_legal_entity_id, to_legal_entity_id);
  END IF;
END $entity_composite$;

CREATE OR REPLACE FUNCTION prevent_entity_registration_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'Approved registration versions are immutable; submit a new reviewed version.';
END $body$;
DO $version_trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='immutable_entity_registration_versions') THEN
    CREATE TRIGGER immutable_entity_registration_versions
      BEFORE UPDATE OR DELETE ON legal_entity_statutory_registrations
      FOR EACH ROW EXECUTE FUNCTION prevent_entity_registration_history_mutation();
  END IF;
END $version_trigger$;

-- Application rollback: turn both feature flags OFF; preserve append-only
-- registration history and approved audit. DBA rollback: restore protected
-- rehearsed clone/snapshot only under separately authorized cutover protocol.
