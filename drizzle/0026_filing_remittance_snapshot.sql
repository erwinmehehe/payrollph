ALTER TABLE "government_filing_validations"
  ADD COLUMN IF NOT EXISTS "applicable_month" varchar(7),
  ADD COLUMN IF NOT EXISTS "employee_count" integer,
  ADD COLUMN IF NOT EXISTS "reported_total" numeric(14,2);

CREATE INDEX IF NOT EXISTS "government_filing_month_idx"
  ON "government_filing_validations" ("organization_id", "agency", "applicable_month", "status");
