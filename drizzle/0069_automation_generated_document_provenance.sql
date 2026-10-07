-- Governed Automation Studio generated-document provenance and idempotency.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "source_type" varchar(24) NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS "source_key" varchar(160),
  ADD COLUMN IF NOT EXISTS "generation_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_source_type_check";

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_source_type_check"
  CHECK ("source_type" IN ('upload','generated'));

CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_source_key_unique"
  ON "documents" ("organization_id","source_key")
  WHERE "source_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "documents_org_employee_source_idx"
  ON "documents" ("organization_id","employee_id","source_type","created_at");
