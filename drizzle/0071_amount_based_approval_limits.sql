-- Amount-aware approval-chain routing and immutable routing evidence.

ALTER TABLE "approval_chain_instances"
  ADD COLUMN IF NOT EXISTS "amount" numeric(14,2),
  ADD COLUMN IF NOT EXISTS "amount_currency" varchar(3),
  ADD COLUMN IF NOT EXISTS "amount_basis" varchar(64),
  ADD COLUMN IF NOT EXISTS "routing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "approval_chain_instances"
  DROP CONSTRAINT IF EXISTS "approval_chain_instances_amount_nonnegative_check";

ALTER TABLE "approval_chain_instances"
  ADD CONSTRAINT "approval_chain_instances_amount_nonnegative_check"
  CHECK ("amount" IS NULL OR "amount" >= 0);
