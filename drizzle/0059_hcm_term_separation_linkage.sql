-- HCM Core 3.2: authoritative linkage from non-renewal decisions into Separation.
-- Handoff state advances only through the real separation/final-pay workflow.

ALTER TABLE "hcm_employment_term_decisions"
  ADD COLUMN IF NOT EXISTS "separation_record_id" integer REFERENCES "separation_records"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "separation_handoff_started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "separation_handoff_completed_at" timestamptz;

-- Core 3.1 allowed manual handoff status markers before an authoritative separation
-- record existed. Normalize any such legacy markers back to ready so they must be
-- revalidated through the actual Separation workflow.
UPDATE "hcm_employment_term_decisions"
SET
  "separation_handoff_status" = 'ready',
  "separation_handoff_started_at" = NULL,
  "separation_handoff_completed_at" = NULL
WHERE "decision_kind" = 'non_renew'
  AND "status" = 'applied'
  AND "separation_handoff_status" IN ('started','completed')
  AND "separation_record_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employment_term_decisions_separation_unique"
  ON "hcm_employment_term_decisions" ("separation_record_id")
  WHERE "separation_record_id" IS NOT NULL;

ALTER TABLE "hcm_employment_term_decisions"
  DROP CONSTRAINT IF EXISTS "hcm_employment_term_decision_separation_link_valid";

ALTER TABLE "hcm_employment_term_decisions"
  ADD CONSTRAINT "hcm_employment_term_decision_separation_link_valid" CHECK (
    (
      "separation_handoff_status" IN ('none','ready')
      AND "separation_record_id" IS NULL
      AND "separation_handoff_started_at" IS NULL
      AND "separation_handoff_completed_at" IS NULL
    )
    OR
    (
      "separation_handoff_status" = 'started'
      AND "decision_kind" = 'non_renew'
      AND "separation_record_id" IS NOT NULL
      AND "separation_handoff_started_at" IS NOT NULL
      AND "separation_handoff_completed_at" IS NULL
    )
    OR
    (
      "separation_handoff_status" = 'completed'
      AND "decision_kind" = 'non_renew'
      AND "separation_record_id" IS NOT NULL
      AND "separation_handoff_started_at" IS NOT NULL
      AND "separation_handoff_completed_at" IS NOT NULL
    )
  );
