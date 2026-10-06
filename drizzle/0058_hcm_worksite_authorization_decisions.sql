-- Explicit dated allow/deny decisions for HCM worksite eligibility.
-- Existing rows remain allows for backward compatibility.
ALTER TABLE "hcm_worksite_authorizations"
  ADD COLUMN IF NOT EXISTS "decision" varchar(8) NOT NULL DEFAULT 'allow';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hcm_worksite_authorization_decision_check'
  ) THEN
    ALTER TABLE "hcm_worksite_authorizations"
      ADD CONSTRAINT "hcm_worksite_authorization_decision_check"
      CHECK ("decision" IN ('allow','deny'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "hcm_worksite_authorizations_decision_idx"
  ON "hcm_worksite_authorizations" ("organization_id","employee_id","worksite_id","decision","effective_from");
