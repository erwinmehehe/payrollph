-- 0120: enhanced workforce punch evidence (default OFF).
-- Stage all enhanced employee web/mobile punches for independent review.
-- This must be applied and rehearsed BEFORE WFM_PUNCH_EVIDENCE_ENABLED=true.
CREATE TABLE IF NOT EXISTS worksite_punch_policies (
  worksite_id integer PRIMARY KEY REFERENCES worksites(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  photo_mode varchar(12) NOT NULL DEFAULT 'off' CHECK (photo_mode in ('off','optional','required')),
  updated_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worksite_punch_policies_org_idx ON worksite_punch_policies (organization_id);

CREATE TABLE IF NOT EXISTS workforce_punch_photo_consents (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  consent_version varchar(32) NOT NULL,
  choice varchar(16) NOT NULL CHECK (choice in ('accepted','declined')),
  decided_by_user_id integer NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_punch_consent_unique
  ON workforce_punch_photo_consents (organization_id, employee_id, consent_version);

CREATE TABLE IF NOT EXISTS workforce_punch_photo_evidence (
  id varchar(36) PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  sealed_photo text,
  mime_type varchar(24) NOT NULL DEFAULT 'image/jpeg',
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS workforce_punch_photo_expiry_idx ON workforce_punch_photo_evidence (expires_at);
CREATE INDEX IF NOT EXISTS workforce_punch_photo_employee_idx ON workforce_punch_photo_evidence (organization_id, employee_id);

CREATE TABLE IF NOT EXISTS workforce_punch_submissions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_punch_id varchar(36) NOT NULL,
  action_type varchar(20) NOT NULL,
  work_date date NOT NULL,
  device_occurred_at timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  received_source varchar(12) NOT NULL CHECK (received_source in ('online','offline')),
  worksite_id integer REFERENCES worksites(id) ON DELETE SET NULL,
  photo_evidence_id varchar(36) REFERENCES workforce_punch_photo_evidence(id) ON DELETE SET NULL,
  device_digest varchar(64) NOT NULL,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(flags) = 'array'),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status in ('pending','approved','rejected')),
  requested_by_user_id integer NOT NULL REFERENCES users(id),
  reviewed_by_user_id integer REFERENCES users(id),
  reviewed_at timestamptz,
  review_note varchar(240),
  approved_time_source varchar(12),
  time_punch_id integer REFERENCES time_punches(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_punch_client_id_unique
  ON workforce_punch_submissions (organization_id, employee_id, client_punch_id);
CREATE INDEX IF NOT EXISTS workforce_punch_pending_idx
  ON workforce_punch_submissions (organization_id, status, server_received_at);
CREATE INDEX IF NOT EXISTS workforce_punch_signal_idx
  ON workforce_punch_submissions (organization_id, device_digest, server_received_at);
CREATE INDEX IF NOT EXISTS workforce_punch_employee_time_idx
  ON workforce_punch_submissions (organization_id, employee_id, device_occurred_at);
-- Raw device coordinates and unencrypted images have no columns here.


-- In addition to standalone foreign keys, enforce that each linked employee,
-- worksite, photo and time-punch belongs to the same tenant and employee.
-- The API also enforces authorization. These triggers guard direct DB writes.
-- CREATE OR REPLACE permits an atomic, idempotent migration rehearsal.
CREATE OR REPLACE FUNCTION validate_wfm_punch_tenant_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'worksite_punch_policies' THEN
    PERFORM 1 FROM worksites w
      WHERE w.id = NEW.worksite_id AND w.organization_id = NEW.organization_id
      FOR SHARE;
  ELSE
    PERFORM 1 FROM employees e
      WHERE e.id = NEW.employee_id AND e.organization_id = NEW.organization_id
      FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WFM_PUNCH_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'workforce_punch_submissions' THEN
    IF NEW.worksite_id IS NOT NULL THEN
      PERFORM 1 FROM worksites w
        WHERE w.id = NEW.worksite_id AND w.organization_id = NEW.organization_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_WORKSITE_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.photo_evidence_id IS NOT NULL THEN
      PERFORM 1 FROM workforce_punch_photo_evidence p
        WHERE p.id = NEW.photo_evidence_id
          AND p.organization_id = NEW.organization_id
          AND p.employee_id = NEW.employee_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_PHOTO_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.time_punch_id IS NOT NULL THEN
      PERFORM 1 FROM time_punches t
        WHERE t.id = NEW.time_punch_id
          AND t.organization_id = NEW.organization_id
          AND t.employee_id = NEW.employee_id
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WFM_PUNCH_TIMECARD_TENANT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'WFM_PUNCH_REQUIRES_INDEPENDENT_REVIEW' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'pending' AND (
      NEW.reviewed_by_user_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
      OR NEW.time_punch_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'WFM_PUNCH_PENDING_CANNOT_ENTER_ATTENDANCE' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('approved', 'rejected') AND (
      NEW.reviewed_by_user_id IS NULL OR NEW.reviewed_at IS NULL
      OR NEW.reviewed_by_user_id = NEW.requested_by_user_id
      OR length(trim(coalesce(NEW.review_note, ''))) < 10
    ) THEN
      RAISE EXCEPTION 'WFM_PUNCH_REQUIRES_DISTINCT_HUMAN_CHECKER' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'WFM_PUNCH_REVIEW_DECISION_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER wfm_worksite_policy_tenant_guard
  BEFORE INSERT OR UPDATE ON worksite_punch_policies
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();
CREATE OR REPLACE TRIGGER wfm_punch_consent_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_photo_consents
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();
CREATE OR REPLACE TRIGGER wfm_punch_photo_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_photo_evidence
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();
CREATE OR REPLACE TRIGGER wfm_punch_submission_tenant_guard
  BEFORE INSERT OR UPDATE ON workforce_punch_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_wfm_punch_tenant_scope();
