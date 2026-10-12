-- A-5 schema proposal. Do NOT apply to production or allocate a numbered
-- migration without DBA reconciliation of the canonical #865 0115-0121 train.
-- CI may apply only to a disposable PostgreSQL or isolated QA branch.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "object_storage_key" varchar(512);
CREATE UNIQUE INDEX IF NOT EXISTS "documents_object_storage_key_unique"
  ON "documents" ("object_storage_key")
  WHERE "object_storage_key" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "hcm_document_expiry_notices" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "compliance_id" integer NOT NULL REFERENCES "hcm_employee_document_compliance"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "expires_on" date NOT NULL,
  "milestone_days" integer NOT NULL CHECK ("milestone_days" IN (30, 14, 7)),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz,
  "acknowledged_by_user_id" integer REFERENCES "users"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_document_expiry_notice_unique"
  ON "hcm_document_expiry_notices" ("compliance_id", "document_id", "expires_on", "milestone_days");
CREATE INDEX IF NOT EXISTS "hcm_document_expiry_notice_inbox_idx"
  ON "hcm_document_expiry_notices" ("organization_id", "acknowledged_at", "created_at");
