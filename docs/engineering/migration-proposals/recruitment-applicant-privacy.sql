-- A-2 DESIGN PROPOSAL ONLY. NOT AN EXECUTABLE/ALLOCATED RELEASE MIGRATION.
-- Do not apply to live Neon. DBA must allocate a unique successor after canonical
-- 0115-0121 train, verify historical receipts/restore and implement DPO retention policy.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS job_applicants_org_id_privacy_fk
  ON job_applicants (organization_id, id);
CREATE TABLE IF NOT EXISTS applicant_privacy_evidence (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  applicant_id INTEGER NOT NULL,
  legal_basis VARCHAR(32) NOT NULL CHECK (legal_basis = 'consent'),
  privacy_notice_version VARCHAR(64) NOT NULL,
  consent_captured_at TIMESTAMPTZ NOT NULL,
  source_evidence_reference VARCHAR(200) NOT NULL,
  rejected_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  purged_at TIMESTAMPTZ,
  purged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deletion_requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deletion_requested_at TIMESTAMPTZ,
  deletion_reason VARCHAR(500),
  deletion_reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deletion_reviewed_at TIMESTAMPTZ,
  deletion_review_evidence_reference VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT applicant_privacy_employer_fk
    FOREIGN KEY (organization_id, applicant_id)
    REFERENCES job_applicants(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT applicant_privacy_purged_rejected_check
    CHECK (purged_at IS NULL OR rejected_at IS NOT NULL),
  CONSTRAINT applicant_privacy_org_candidate_unique
    UNIQUE (organization_id, applicant_id)
);
CREATE INDEX IF NOT EXISTS applicant_privacy_rejection_due_idx
  ON applicant_privacy_evidence (organization_id, rejected_at, purged_at);
COMMIT;
