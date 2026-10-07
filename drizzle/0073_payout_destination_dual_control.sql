-- Dual control for employee payout destination changes when treasury separation is enabled.

CREATE TABLE IF NOT EXISTS "employee_payout_change_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "status" varchar(24) NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','approved','rejected','cancelled')),
  "reason" varchar(360) NOT NULL,
  "original_snapshot" jsonb NOT NULL,
  "original_state_sha256" varchar(64) NOT NULL,
  "proposed_bank_account" varchar(160),
  "proposed_bank_code" varchar(16),
  "proposed_mobile" varchar(24),
  "proposed_masked_account" varchar(64),
  "requested_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "requested_by_name" varchar(120) NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by_name" varchar(120),
  "decision_note" varchar(500),
  "decided_at" timestamptz,
  "applied_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_payout_change_requests_open_employee_unique"
  ON "employee_payout_change_requests" ("organization_id","employee_id")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "employee_payout_change_requests_org_status_idx"
  ON "employee_payout_change_requests" ("organization_id","status","created_at");

CREATE INDEX IF NOT EXISTS "employee_payout_change_requests_employee_idx"
  ON "employee_payout_change_requests" ("organization_id","employee_id","created_at");
