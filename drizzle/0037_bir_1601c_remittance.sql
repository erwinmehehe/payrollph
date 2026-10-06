CREATE TABLE IF NOT EXISTS "bir_withholding_remittance_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "applicable_month" varchar(7) NOT NULL,
  "filing_channel" varchar(24) NOT NULL,
  "efps_group" varchar(1),
  "filing_due_date" date NOT NULL,
  "payment_due_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "employee_count" integer DEFAULT 0 NOT NULL,
  "payroll_run_count" integer DEFAULT 0 NOT NULL,
  "expected_tax_withheld" numeric(14,2) DEFAULT '0' NOT NULL,
  "amount_paid" numeric(14,2),
  "payment_reference" varchar(120),
  "payment_variance_note" varchar(240),
  "paid_at" timestamptz,
  "payment_recorded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "payment_recorded_by" varchar(120),
  "filing_validation_id" integer REFERENCES "government_filing_validations"("id") ON DELETE set null,
  "filing_reference" varchar(120),
  "filed_at" timestamptz,
  "snapshot_hash" varchar(64) NOT NULL,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "bir_withholding_remittance_month_unique"
  ON "bir_withholding_remittance_batches" ("organization_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "bir_withholding_remittance_due_idx"
  ON "bir_withholding_remittance_batches" ("organization_id", "status", "payment_due_date");
CREATE INDEX IF NOT EXISTS "bir_withholding_remittance_filing_idx"
  ON "bir_withholding_remittance_batches" ("organization_id", "filing_validation_id");
