-- Additive only. Apply through the reviewed migration workflow, never app boot.
CREATE TABLE year_end_prior_evidence (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  employee_id integer NOT NULL REFERENCES employees(id),
  tax_year integer NOT NULL CONSTRAINT year_end_prior_evidence_year_ck CHECK (tax_year BETWEEN 2023 AND 2100),
  revision integer NOT NULL DEFAULT 1 CONSTRAINT year_end_prior_evidence_revision_ck CHECK (revision > 0),
  encrypted_evidence text NOT NULL CONSTRAINT year_end_prior_evidence_encrypted_ck CHECK (encrypted_evidence LIKE 'enc:govid:v1:%'),
  source_digest varchar(64) NOT NULL CONSTRAINT year_end_prior_evidence_digest_ck CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  maker_user_id integer NOT NULL REFERENCES users(id),
  checker_user_id integer REFERENCES users(id),
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT year_end_prior_evidence_employee_scope_fk FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id),
  CONSTRAINT year_end_prior_evidence_checker_ck CHECK (
    (checker_user_id IS NULL AND approved_at IS NULL) OR
    (checker_user_id IS NOT NULL AND approved_at IS NOT NULL AND checker_user_id <> maker_user_id)
  )
);
CREATE UNIQUE INDEX year_end_prior_evidence_scope_uq
  ON year_end_prior_evidence (organization_id, employee_id, tax_year);
