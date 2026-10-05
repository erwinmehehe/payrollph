CREATE TABLE IF NOT EXISTS "statutory_remittance_correction_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "target_type" varchar(32) NOT NULL,
  "batch_id" integer NOT NULL REFERENCES "statutory_remittance_batches"("id") ON DELETE cascade,
  "member_id" integer REFERENCES "statutory_remittance_members"("id") ON DELETE cascade,
  "original_snapshot" jsonb NOT NULL,
  "proposed_snapshot" jsonb NOT NULL,
  "reason" varchar(360) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by_name" varchar(120) NOT NULL,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by_name" varchar(120),
  "decision_note" varchar(360),
  "decided_at" timestamptz,
  "applied_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "statutory_remittance_corrections_status_idx"
  ON "statutory_remittance_correction_requests" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "statutory_remittance_corrections_batch_idx"
  ON "statutory_remittance_correction_requests" ("organization_id", "batch_id");
CREATE INDEX IF NOT EXISTS "statutory_remittance_corrections_member_idx"
  ON "statutory_remittance_correction_requests" ("organization_id", "member_id");
