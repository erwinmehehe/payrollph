CREATE TABLE IF NOT EXISTS "statutory_remittance_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agency" varchar(16) NOT NULL,
  "applicable_month" varchar(7) NOT NULL,
  "due_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "employee_count" integer DEFAULT 0 NOT NULL,
  "expected_employee_share" numeric(14,2) DEFAULT '0' NOT NULL,
  "expected_employer_share" numeric(14,2) DEFAULT '0' NOT NULL,
  "expected_total" numeric(14,2) DEFAULT '0' NOT NULL,
  "amount_paid" numeric(14,2),
  "payment_reference" varchar(120),
  "agency_receipt_reference" varchar(120),
  "payment_channel" varchar(80),
  "payment_variance_note" varchar(240),
  "paid_at" timestamptz,
  "payment_recorded_by" varchar(120),
  "reconciled_at" timestamptz,
  "reconciled_by" varchar(120),
  "snapshot_hash" varchar(64) NOT NULL,
  "notes" text,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "statutory_remittance_batch_unique"
  ON "statutory_remittance_batches" ("organization_id", "agency", "applicable_month");
CREATE INDEX IF NOT EXISTS "statutory_remittance_due_idx"
  ON "statutory_remittance_batches" ("organization_id", "status", "due_date");

CREATE TABLE IF NOT EXISTS "statutory_remittance_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" integer NOT NULL REFERENCES "statutory_remittance_batches"("id") ON DELETE cascade,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "employee_no" varchar(32) NOT NULL,
  "employee_share" numeric(12,2) DEFAULT '0' NOT NULL,
  "employer_share" numeric(12,2) DEFAULT '0' NOT NULL,
  "total_contribution" numeric(12,2) DEFAULT '0' NOT NULL,
  "posting_status" varchar(24) DEFAULT 'pending' NOT NULL,
  "posting_reference" varchar(120),
  "posted_at" timestamptz,
  "confirmed_by" varchar(120),
  "exception_note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "statutory_remittance_member_unique"
  ON "statutory_remittance_members" ("batch_id", "employee_id");
CREATE INDEX IF NOT EXISTS "statutory_remittance_member_status_idx"
  ON "statutory_remittance_members" ("organization_id", "posting_status");
