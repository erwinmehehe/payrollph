-- Phase 1: write new scanned documents to private object storage.
-- Phase 2: migrate existing content via the reviewed migration script, verify hashes and signed reads.
-- Phase 3: only after independent reconciliation, remove legacy content in a later migration.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storage_key" varchar(512);
CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_storage_key_unique"
  ON "documents" ("organization_id", "storage_key") WHERE "storage_key" IS NOT NULL;
