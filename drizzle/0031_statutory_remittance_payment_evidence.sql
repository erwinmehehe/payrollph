CREATE TABLE IF NOT EXISTS "statutory_remittance_payment_evidence" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "batch_id" integer NOT NULL REFERENCES "statutory_remittance_batches"("id") ON DELETE cascade,
  "file_name" varchar(180) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "byte_size" integer NOT NULL,
  "file_sha256" varchar(64) NOT NULL,
  "file_data_base64" text NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "replacement_reason" varchar(280),
  "uploaded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "uploaded_by_name" varchar(120) NOT NULL,
  "uploaded_at" timestamptz DEFAULT now() NOT NULL,
  "superseded_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "statutory_remittance_payment_evidence_hash_unique"
  ON "statutory_remittance_payment_evidence" ("batch_id", "file_sha256");
CREATE INDEX IF NOT EXISTS "statutory_remittance_payment_evidence_batch_idx"
  ON "statutory_remittance_payment_evidence" ("organization_id", "batch_id", "status");
