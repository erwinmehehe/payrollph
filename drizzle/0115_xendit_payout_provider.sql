-- 0115: additive provider expansion for Xendit V3 (default for NEW batches).
-- Follow WFM draft 0112, 0113 and separately approved 0114 staffing policy.
-- Apply only after an independently reviewed backup and isolated migration
-- rehearsal. Source merge must not trigger live payroll or data backfills.
-- Existing PayMongo batches and bank-file payout profiles remain unchanged.

ALTER TABLE "payout_batches" DROP CONSTRAINT IF EXISTS "payout_batches_provider_check";
ALTER TABLE "payout_batches"
  ADD CONSTRAINT "payout_batches_provider_check"
  CHECK ("provider" IN ('paymongo','xendit'));
ALTER TABLE "payout_batches" ALTER COLUMN "provider" SET DEFAULT 'xendit';

ALTER TABLE "payout_transfers" DROP CONSTRAINT IF EXISTS "payout_transfers_status_check";
ALTER TABLE "payout_transfers"
  ADD CONSTRAINT "payout_transfers_status_check"
  CHECK ("status" IN ('prepared','submitting','submitted','succeeded','failed','reversed','reconciliation_required','cancelled'));
ALTER TABLE "payout_batch_transfers" DROP CONSTRAINT IF EXISTS "payout_batch_transfers_status_check";
ALTER TABLE "payout_batch_transfers"
  ADD CONSTRAINT "payout_batch_transfers_status_check"
  CHECK ("status" IN ('prepared','submitting','submitted','succeeded','failed','reversed','reconciliation_required','cancelled'));

ALTER TABLE "payout_profiles" DROP CONSTRAINT IF EXISTS "payout_profiles_default_method_check";
ALTER TABLE "payout_profiles"
  ADD CONSTRAINT "payout_profiles_default_method_check"
  CHECK ("default_method" IN ('bank_file','paymongo','xendit','manual'));
ALTER TABLE "payout_profiles" ALTER COLUMN "default_method" SET DEFAULT 'xendit';

-- No automatic conversion of legacy payout batches or active employer profiles.
