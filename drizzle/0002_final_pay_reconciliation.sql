ALTER TABLE separation_records
  ADD COLUMN IF NOT EXISTS final_pay_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
