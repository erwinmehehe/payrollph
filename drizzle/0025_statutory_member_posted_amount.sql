ALTER TABLE "statutory_remittance_members"
  ADD COLUMN IF NOT EXISTS "posted_amount" numeric(12,2);
