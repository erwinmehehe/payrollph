CREATE TABLE IF NOT EXISTS "statutory_remittance_obligations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agency" varchar(16) NOT NULL,
  "applicable_month" varchar(7) NOT NULL,
  "due_date" date,
  "due_rule" text NOT NULL,
  "expected_employee_amount" numeric(14,2) DEFAULT '0' NOT NULL,
  "expected_employer_amount" numeric(14,2) DEFAULT '0' NOT NULL,
  "expected_total_amount" numeric(14,2) DEFAULT '0' NOT NULL,
  "employee_count" integer DEFAULT 0 NOT NULL,
  "source_payroll_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "payment_reference" varchar(120),
  "paid_amount" numeric(14,2),
  "remitted_at" timestamptz,
  "posting_reference" varchar(120),
  "posting_confirmed_at" timestamptz,
  "evidence_note" text,
  "recorded_by" varchar(120),
  "recorded_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "confirmed_by" varchar(120),
  "confirmed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "confirmed_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "statutory_remittance_org_agency_month_unique"
  ON "statutory_remittance_obligations" ("organization_id", "agency", "applicable_month");

CREATE INDEX IF NOT EXISTS "statutory_remittance_due_status_idx"
  ON "statutory_remittance_obligations" ("organization_id", "due_date", "status");
