DO $compat$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_type_check'
      AND pg_get_constraintdef(oid) NOT ILIKE '%referred%'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      DROP CONSTRAINT "statutory_contribution_issue_event_type_check";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statutory_contribution_issue_event_type_check'
  ) THEN
    ALTER TABLE "statutory_contribution_issue_events"
      ADD CONSTRAINT "statutory_contribution_issue_event_type_check"
      CHECK ("event_type" IN ('reported', 'review_started', 'payroll_update', 'referred', 'resolved'));
  END IF;
END
$compat$;
