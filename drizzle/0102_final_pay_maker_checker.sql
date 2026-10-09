-- Stable financial-authority evidence for offboarding packages.
-- Historical approvals cannot be attributed to a stable account reliably:
-- nullable columns deliberately require a new independently reviewed package
-- rather than inventing an approver ID from human-readable audit text.
ALTER TABLE "separation_records"
  ADD COLUMN IF NOT EXISTS "prepared_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "separation_records"
  ADD COLUMN IF NOT EXISTS "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "separation_records"
  ADD COLUMN IF NOT EXISTS "released_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "separation_records"."prepared_by_user_id"
  IS 'Stable final-pay preparer identity; updated whenever draft amounts are recomputed';
COMMENT ON COLUMN "separation_records"."approved_by_user_id"
  IS 'Different, independent company-wide final-pay checker';
COMMENT ON COLUMN "separation_records"."released_by_user_id"
  IS 'Third distinct company-wide financial releaser after recorded payout evidence';

-- The database rejects same-user pay preparation and checking even if a
-- second mutation path bypasses application-level validation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'separation_review_identity_separation_check'
      AND conrelid = 'separation_records'::regclass
  ) THEN
    ALTER TABLE "separation_records"
      ADD CONSTRAINT "separation_review_identity_separation_check"
        CHECK ("prepared_by_user_id" IS NULL
          OR "approved_by_user_id" IS NULL
          OR "prepared_by_user_id" <> "approved_by_user_id");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "separation_records_org_status_idx"
  ON "separation_records"("organization_id", "status", "id");
