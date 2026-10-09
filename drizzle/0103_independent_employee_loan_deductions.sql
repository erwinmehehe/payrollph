-- New loan deductions must not be executable until reviewed by someone
-- other than their registrant. Legacy rows keep their existing status;
-- they have null actor IDs and require independent historical QA.
ALTER TABLE "employee_loans"
  ADD COLUMN IF NOT EXISTS "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deduction_authorization_reference" varchar(200),
  ADD COLUMN IF NOT EXISTS "review_evidence_reference" varchar(200),
  ADD COLUMN IF NOT EXISTS "review_reason" varchar(500);

-- Do not retroactively overwrite historical active loans. A fresh insert
-- omitting status, however, can no longer activate a deduction implicitly.
ALTER TABLE "employee_loans" ALTER COLUMN "status" SET DEFAULT 'pending_approval';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_loans_independent_deduction_check'
  ) THEN
    ALTER TABLE "employee_loans"
      ADD CONSTRAINT "employee_loans_independent_deduction_check" CHECK (
        "requested_by_user_id" IS NULL
        OR "status" NOT IN ('active', 'paused', 'paid_off')
        OR (
          "reviewed_by_user_id" IS NOT NULL
          AND "requested_by_user_id" <> "reviewed_by_user_id"
          AND "reviewed_at" IS NOT NULL
          AND "review_evidence_reference" IS NOT NULL
          AND length(trim("review_evidence_reference")) >= 8
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "employee_loans_org_status_idx"
  ON "employee_loans"("organization_id", "status", "id");
