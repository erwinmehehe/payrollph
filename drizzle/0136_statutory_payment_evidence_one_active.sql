-- Forward-only one-active receipt guard: apply via protected reviewed migrations.
-- Existing duplicate active receipts require independent evidence/audit review;
-- never silently supersede or delete existing payment-proof data.
DO $integrity$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.statutory_remittance_payment_evidence
      WHERE status = 'active' GROUP BY batch_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active statutory payment proof: resolve with evidence/audit review before 0136';
  END IF;
END $integrity$;

CREATE UNIQUE INDEX IF NOT EXISTS statutory_remittance_payment_evidence_one_active_unique
  ON public.statutory_remittance_payment_evidence USING btree (batch_id)
  WHERE status = 'active';
