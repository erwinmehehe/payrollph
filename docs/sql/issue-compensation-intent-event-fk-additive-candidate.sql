-- 2026-10-17: REVIEW-ONLY, UNNUMBERED ADDITIVE CANDIDATE. Do NOT execute against
-- production or rename into drizzle/ without a separate reviewed SHA and the
-- protected PLAN/APPLY path; production schema repair stays human/DBA-gated.
-- Why: drizzle/0100 declares compensation_automation_intents.compensation_event_id
-- REFERENCES compensation_events ON DELETE cascade. On a recovery path where
-- compensation_events is recreated (0126) the FK is not restored, and the
-- compensation-release-schema release gate fails (foreign_key_missing_or_unsafe).
-- The FK is added NOT VALID (brief lock, no scan) and then validated, so a
-- failing validate (orphan rows) aborts the whole block and leaves no change.
-- Orphans are NEVER deleted here; resolve them by an approved data review first.
DO $comp_intent_event_fk$
DECLARE
  orphans bigint;
BEGIN
  IF pg_catalog.to_regclass('public.compensation_automation_intents') IS NULL
     OR pg_catalog.to_regclass('public.compensation_events') IS NULL THEN
    RAISE EXCEPTION 'COMP_INTENT_FK_TABLES_MISSING' USING ERRCODE = 'P0001';
  END IF;

  LOCK TABLE public.compensation_automation_intents IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.compensation_events IN SHARE ROW EXCLUSIVE MODE NOWAIT;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
             WHERE conrelid = 'public.compensation_automation_intents'::regclass
               AND confrelid = 'public.compensation_events'::regclass AND contype = 'f') THEN
    RAISE EXCEPTION 'COMP_INTENT_FK_ALREADY_PRESENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO orphans
  FROM public.compensation_automation_intents i
  WHERE NOT EXISTS (SELECT 1 FROM public.compensation_events e WHERE e.id = i.compensation_event_id);
  IF orphans > 0 THEN
    RAISE EXCEPTION 'COMP_INTENT_FK_ORPHAN_ROWS_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  ALTER TABLE public.compensation_automation_intents
    ADD CONSTRAINT compensation_automation_intents_compensation_event_id_compensat
    FOREIGN KEY (compensation_event_id) REFERENCES public.compensation_events(id)
    ON DELETE cascade NOT VALID;
  ALTER TABLE public.compensation_automation_intents
    VALIDATE CONSTRAINT compensation_automation_intents_compensation_event_id_compensat;
END
$comp_intent_event_fk$;
