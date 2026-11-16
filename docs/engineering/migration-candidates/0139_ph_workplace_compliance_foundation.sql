-- 0139: Philippine workplace compliance pilot. SOURCE ONLY until reviewed,
-- checksum-pinned DBA forward migration and exact target-catalog approval.
-- Do not run db:push or replay historic migrations against production.
-- No retroactive filings, receipts, training, allegations or officer appointments
-- are inferred. All three runtime flags default OFF.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE dole_extended_reports (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  report_type varchar(40) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  statutory_basis_url varchar(350) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  portal_reference varchar(160),
  receipt_sha256 varchar(64),
  submitted_at timestamptz,
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  outcome_recorded_by_user_id integer REFERENCES users(id),
  reviewed_by_user_id integer REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dole_extended_reports_entity_tenant_fk FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES legal_entities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT dole_extended_reports_dates_ck CHECK (period_end >= period_start),
  CONSTRAINT dole_extended_reports_status_ck CHECK
    (status IN ('draft','submitted_recorded','accepted_recorded','rejected_recorded','independently_reviewed'))
);
CREATE INDEX dole_extended_reports_employer_period_idx
  ON dole_extended_reports(organization_id, legal_entity_id, period_start);

CREATE TABLE osh_safety_events (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  worksite_label varchar(120) NOT NULL,
  occurred_on date NOT NULL,
  event_kind varchar(32) NOT NULL,
  severity varchar(16) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  evidence_sha256 varchar(64),
  corrective_action_ref varchar(160),
  action_owner_user_id integer REFERENCES users(id),
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  reviewed_by_user_id integer REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osh_safety_events_entity_tenant_fk FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES legal_entities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT osh_safety_events_kind_ck CHECK
    (event_kind IN ('hazard','near_miss','injury','illness','other')),
  CONSTRAINT osh_safety_events_severity_ck CHECK
    (severity IN ('low','moderate','high','critical')),
  CONSTRAINT osh_safety_events_status_ck CHECK
    (status IN ('open','mitigating','resolved'))
);
CREATE INDEX osh_safety_events_scope_date_idx
  ON osh_safety_events(organization_id, legal_entity_id, occurred_on);

CREATE TABLE osh_training_records (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  employee_id integer NOT NULL,
  topic varchar(48) NOT NULL,
  course_title varchar(160) NOT NULL,
  provider_name varchar(120),
  completed_on date NOT NULL,
  expires_on date,
  evidence_sha256 varchar(64),
  requirement_source varchar(350),
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  -- Human countersignature only; no object/digest verification performed.
  attested_by_user_id integer REFERENCES users(id),
  attested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osh_training_entity_tenant_fk FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES legal_entities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT osh_training_employee_tenant_fk FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT osh_training_records_topic_ck CHECK
    (topic IN ('osh_orientation','fire_safety','first_aid','harassment_prevention','other')),
  CONSTRAINT osh_training_records_dates_ck CHECK
    (expires_on IS NULL OR expires_on >= completed_on)
);
CREATE INDEX osh_training_records_employee_idx
  ON osh_training_records(organization_id, legal_entity_id, employee_id, completed_on);

CREATE TABLE workplace_case_officers (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  user_id integer NOT NULL REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  appointed_by_user_id integer NOT NULL REFERENCES users(id),
  appointed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT workplace_case_officers_entity_tenant_fk FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES legal_entities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workplace_case_officers_scope_user_uk UNIQUE (organization_id, legal_entity_id, user_id)
);
CREATE INDEX workplace_case_officers_scope_active_idx
  ON workplace_case_officers(organization_id, legal_entity_id, active);

CREATE TABLE workplace_protected_cases (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  case_kind varchar(36) NOT NULL,
  created_by_user_id integer NOT NULL REFERENCES users(id),
  reporter_employee_id integer,
  investigator_user_id integer NOT NULL,
  reviewer_user_id integer,
  sealed_statement text NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'intake',
  incident_on date,
  external_evidence_sha256 varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workplace_protected_cases_entity_tenant_fk FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES legal_entities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workplace_protected_cases_employee_tenant_fk FOREIGN KEY (organization_id, reporter_employee_id)
    REFERENCES employees(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workplace_protected_cases_investigator_fk FOREIGN KEY
    (organization_id, legal_entity_id, investigator_user_id)
    REFERENCES workplace_case_officers(organization_id, legal_entity_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workplace_protected_cases_reviewer_fk FOREIGN KEY
    (organization_id, legal_entity_id, reviewer_user_id)
    REFERENCES workplace_case_officers(organization_id, legal_entity_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workplace_cases_kind_ck CHECK
    (case_kind IN ('gender_based_harassment','other_harassment','retaliation','other')),
  CONSTRAINT workplace_cases_status_ck CHECK
    (status IN ('intake','investigating','review_pending','closed')),
  CONSTRAINT workplace_cases_independent_review_ck CHECK
    (reviewer_user_id IS NULL OR reviewer_user_id <> investigator_user_id)
);
ALTER TABLE workplace_protected_cases
  ADD CONSTRAINT workplace_cases_scope_id_uk UNIQUE (organization_id, legal_entity_id, id);
CREATE INDEX workplace_cases_investigator_idx
  ON workplace_protected_cases(organization_id, legal_entity_id, investigator_user_id, status);
CREATE INDEX workplace_cases_creator_idx
  ON workplace_protected_cases(organization_id, legal_entity_id, created_by_user_id);

-- Source-only restricted accountability; never included in generic audit export.
CREATE TABLE workplace_case_audit_trail (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  case_id integer NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  action varchar(40) NOT NULL,
  previous_status varchar(24),
  next_status varchar(24),
  previous_officer_user_id integer,
  replacement_officer_user_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workplace_case_audit_scope_fk FOREIGN KEY (organization_id, legal_entity_id, case_id)
    REFERENCES workplace_protected_cases(organization_id, legal_entity_id, id) ON DELETE RESTRICT,
  CONSTRAINT workplace_case_audit_action_ck CHECK
    (action IN ('intake','reviewer_assigned','status_changed','reassignment_requested','reassignment_approved','reassignment_rejected'))
);
CREATE INDEX workplace_case_audit_scope_created_idx
  ON workplace_case_audit_trail(organization_id, legal_entity_id, case_id, created_at);

CREATE TABLE workplace_case_reassignment_requests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL,
  case_id integer NOT NULL,
  officer_role varchar(20) NOT NULL,
  previous_officer_user_id integer NOT NULL REFERENCES users(id),
  replacement_officer_user_id integer NOT NULL REFERENCES users(id),
  requested_by_user_id integer NOT NULL REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT workplace_case_reassignment_scope_fk FOREIGN KEY (organization_id, legal_entity_id, case_id)
    REFERENCES workplace_protected_cases(organization_id, legal_entity_id, id) ON DELETE RESTRICT,
  CONSTRAINT workplace_case_reassignment_role_ck CHECK (officer_role IN ('investigator','reviewer')),
  CONSTRAINT workplace_case_reassignment_status_ck CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT workplace_case_reassignment_signer_ck CHECK (
    (status = 'pending' AND approved_by_user_id IS NULL AND approved_at IS NULL) OR
    (status <> 'pending' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND requested_by_user_id <> approved_by_user_id)
  )
);
CREATE UNIQUE INDEX workplace_case_reassignment_one_pending_uk
  ON workplace_case_reassignment_requests(case_id, officer_role) WHERE status = 'pending';
CREATE INDEX workplace_case_reassignment_scope_idx
  ON workplace_case_reassignment_requests(organization_id, legal_entity_id, status);

COMMIT;
