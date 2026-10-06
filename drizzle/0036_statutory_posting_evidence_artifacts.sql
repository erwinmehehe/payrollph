CREATE TABLE IF NOT EXISTS "statutory_posting_evidence_artifacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "batch_id" integer NOT NULL REFERENCES "statutory_remittance_batches"("id") ON DELETE cascade,
  "source_type" varchar(32) NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "file_name" varchar(200),
  "mime_type" varchar(100),
  "byte_size" integer,
  "content_sha256" varchar(64) NOT NULL,
  "file_data_base64" text,
  "evidence_reference" varchar(160),
  "row_count" integer DEFAULT 1 NOT NULL,
  "recorded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "recorded_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "statutory_posting_evidence_batch_hash_unique"
  ON "statutory_posting_evidence_artifacts" ("organization_id", "batch_id", "content_sha256", "outcome");

CREATE INDEX IF NOT EXISTS "statutory_posting_evidence_batch_idx"
  ON "statutory_posting_evidence_artifacts" ("organization_id", "batch_id", "source_type");

ALTER TABLE "statutory_remittance_members"
  ADD COLUMN IF NOT EXISTS "posting_evidence_artifact_id" integer
  REFERENCES "statutory_posting_evidence_artifacts"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "statutory_remittance_members_evidence_idx"
  ON "statutory_remittance_members" ("organization_id", "posting_evidence_artifact_id");
