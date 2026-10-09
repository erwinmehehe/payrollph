-- An independently reviewed, positive basic-pay underpayment from a RELEASED
-- payroll run can become a one-time taxable earning in a later open cutoff.
-- Historical payroll and current employee base pay are not rewritten.
CREATE TABLE IF NOT EXISTS "payroll_underpayment_requests" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "source_payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  "source_payroll_entry_id" integer NOT NULL REFERENCES "payroll_entries"("id") ON DELETE RESTRICT,
  "source_entry_hash" varchar(64) NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "effective_date" date NOT NULL,
  "reason" varchar(500) NOT NULL,
  "evidence_reference" varchar(200) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending_review',
  "requested_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requested_by" varchar(120) NOT NULL,
  "reviewed_by_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_by" varchar(120),
  "reviewed_at" timestamptz,
  "review_reason" varchar(500),
  "posted_earning_id" integer UNIQUE REFERENCES "supplementary_earnings"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_underpayment_amount_check" CHECK ("amount" > 0 AND "amount" <= 1000000),
  CONSTRAINT "payroll_underpayment_status_check" CHECK ("status" IN ('pending_review','posted','rejected')),
  CONSTRAINT "payroll_underpayment_posted_consistency_check" CHECK (
    ("status" = 'posted' AND "posted_earning_id" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL)
    OR ("status" <> 'posted' AND "posted_earning_id" IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS "payroll_underpayment_requests_org_status_idx"
  ON "payroll_underpayment_requests"("organization_id", "status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_underpayment_one_source_unique"
  ON "payroll_underpayment_requests"("organization_id", "employee_id", "source_payroll_run_id")
  WHERE "status" IN ('pending_review','posted');

COMMENT ON TABLE "payroll_underpayment_requests" IS
  'Independent reviewer evidence for a one-time positive taxable historical underpayment; supplementary earning posts in a later cutoff.';
