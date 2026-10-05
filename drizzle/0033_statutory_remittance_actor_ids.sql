ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "payment_recorded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "reconciled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

ALTER TABLE "statutory_remittance_members"
  ADD COLUMN IF NOT EXISTS "confirmed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "statutory_remittance_batches_payment_recorder_idx"
  ON "statutory_remittance_batches" ("organization_id", "payment_recorded_by_user_id");

CREATE INDEX IF NOT EXISTS "statutory_remittance_batches_reconciler_idx"
  ON "statutory_remittance_batches" ("organization_id", "reconciled_by_user_id");

CREATE INDEX IF NOT EXISTS "statutory_remittance_members_confirmer_idx"
  ON "statutory_remittance_members" ("organization_id", "confirmed_by_user_id");
