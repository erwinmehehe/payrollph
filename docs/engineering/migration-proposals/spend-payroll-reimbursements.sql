-- Unnumbered A4 proposal; isolated rehearsal only, not a production release migration.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_org_employee_id_unique
  ON expense_claims (organization_id, employee_id, id);
CREATE TABLE IF NOT EXISTS expense_category_policies (
  id serial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category varchar(60) NOT NULL, taxable boolean NOT NULL,
  review_reference varchar(200) NOT NULL, reviewed_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_category_policies_org_id_unique UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_category_policies_org_category
  ON expense_category_policies (organization_id, category);
CREATE TABLE IF NOT EXISTS expense_claim_evidence (
  claim_id integer PRIMARY KEY REFERENCES expense_claims(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category_policy_id integer NOT NULL, taxable boolean NOT NULL,
  approved_amount numeric(12,2), approved_by_user_id integer REFERENCES users(id), approved_at timestamptz,
  receipt_storage_key varchar(512), receipt_sha256 varchar(64), receipt_byte_size integer,
  receipt_verified_at timestamptz, receipt_mime varchar(100), receipt_file_name varchar(200), receipt_scan_note varchar(240),
  CONSTRAINT expense_evidence_claim_employer_fk FOREIGN KEY (organization_id, employee_id, claim_id)
    REFERENCES expense_claims(organization_id, employee_id, id) ON DELETE CASCADE,
  CONSTRAINT expense_evidence_policy_employer_fk FOREIGN KEY (organization_id, category_policy_id)
    REFERENCES expense_category_policies(organization_id, id),
  CONSTRAINT expense_evidence_amount_check CHECK (approved_amount IS NULL OR approved_amount > 0),
  CONSTRAINT expense_evidence_receipt_size_check CHECK (receipt_byte_size IS NULL OR receipt_byte_size BETWEEN 1 AND 5242880)
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_evidence_receipt_key_unique ON expense_claim_evidence (receipt_storage_key)
  WHERE receipt_storage_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_evidence_receipt_hash_unique
  -- Require DBA duplicate-hash preflight across ALL workers of this tenant before applying.
  ON expense_claim_evidence (organization_id, receipt_sha256) WHERE receipt_sha256 IS NOT NULL;
COMMIT;
