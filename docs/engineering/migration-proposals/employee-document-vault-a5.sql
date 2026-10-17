-- #1031 / 2026-10-17: current-schema source-only review reconciliation.
-- These are unnumbered proposals, NOT applied migrations or DBA approval.
-- A-5 schema proposal. Do NOT apply to production or allocate a numbered
-- migration without DBA reconciliation of the canonical #865 0115-0121 train.
-- CI may apply only to a disposable PostgreSQL or isolated QA branch.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "object_storage_key" varchar(512);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploaded_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "documents_object_storage_key_unique"
  ON "documents" ("object_storage_key")
  WHERE "object_storage_key" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "hcm_document_expiry_notices" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL CONSTRAINT "hcm_document_expiry_notices_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE CASCADE,
  "compliance_id" integer NOT NULL CONSTRAINT "hcm_document_expiry_notices_compliance_id_hcm_employee_document" REFERENCES "hcm_employee_document_compliance"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL CONSTRAINT "hcm_document_expiry_notices_employee_id_employees_id_fk" REFERENCES "employees"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL CONSTRAINT "hcm_document_expiry_notices_document_id_documents_id_fk" REFERENCES "documents"("id") ON DELETE CASCADE,
  "expires_on" date NOT NULL,
  "milestone_days" integer NOT NULL CONSTRAINT "hcm_document_expiry_notice_milestone_check" CHECK ("milestone_days" IN (30, 14, 7)),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz,
  "acknowledged_by_user_id" integer CONSTRAINT "hcm_document_expiry_notices_acknowledged_by_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_document_expiry_notice_unique"
  ON "hcm_document_expiry_notices" ("compliance_id", "document_id", "expires_on", "milestone_days");
CREATE INDEX IF NOT EXISTS "hcm_document_expiry_notice_inbox_idx"
  ON "hcm_document_expiry_notices" ("organization_id", "acknowledged_at", "created_at");
