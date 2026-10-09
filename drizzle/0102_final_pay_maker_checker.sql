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
