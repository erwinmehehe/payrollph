-- Safe additive HCM financial reviewer identities, not a historical backfill.
-- Old approved records have null reviewer IDs and must be recomputed/reapproved
-- under the governed workflow before final-pay release.
ALTER TABLE "separation_records"
  ADD COLUMN IF NOT EXISTS "prepared_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "released_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'separation_review_identity_separation_check'
  ) THEN
    ALTER TABLE "separation_records" ADD CONSTRAINT "separation_review_identity_separation_check"
      CHECK (
        "prepared_by_user_id" IS NULL OR "approved_by_user_id" IS NULL
        OR "prepared_by_user_id" <> "approved_by_user_id"
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "separation_records_org_status_idx"
  ON "separation_records"("organization_id", "status", "id");
