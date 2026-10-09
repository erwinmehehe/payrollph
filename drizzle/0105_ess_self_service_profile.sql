-- ESS profile photos and audited employee identifier correction requests.
-- Apply on the selected environment before enabling ESS profile features.
CREATE TABLE IF NOT EXISTS ess_employee_photos (
  employee_id integer PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mime_type varchar(24) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 524288),
  sealed_photo text NOT NULL,
  content_sha256 varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ess_employee_photos_org_idx ON ess_employee_photos(organization_id);

CREATE TABLE IF NOT EXISTS ess_identifier_requests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  proposed_encrypted varchar(256) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  requested_by_user_id integer NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id integer REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text
);
CREATE INDEX IF NOT EXISTS ess_identifier_requests_employee_idx
  ON ess_identifier_requests(employee_id, requested_at);
CREATE INDEX IF NOT EXISTS ess_identifier_requests_org_status_idx
  ON ess_identifier_requests(organization_id, status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS ess_identifier_requests_one_pending
  ON ess_identifier_requests(employee_id, kind) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS ess_other_identifiers (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  encrypted_value varchar(256) NOT NULL,
  verified_by_user_id integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ess_other_identifiers_unique
  ON ess_other_identifiers(employee_id,kind);
CREATE INDEX IF NOT EXISTS ess_other_identifiers_org_idx
  ON ess_other_identifiers(organization_id);
