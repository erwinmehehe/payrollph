CREATE TABLE IF NOT EXISTS "managed_payroll_engagements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status" varchar(24) NOT NULL DEFAULT 'pilot',
  "service_tier" varchar(48) NOT NULL DEFAULT 'Managed payroll',
  "client_approver_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "sla_hours" integer NOT NULL DEFAULT 24,
  "target_go_live" date,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_engagement_org_unique"
  ON "managed_payroll_engagements" ("organization_id");

CREATE TABLE IF NOT EXISTS "managed_payroll_gates" (
  "id" serial PRIMARY KEY NOT NULL,
  "engagement_id" integer NOT NULL REFERENCES "managed_payroll_engagements"("id") ON DELETE CASCADE,
  "gate_key" varchar(64) NOT NULL,
  "label" varchar(180) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "evidence_ref" text,
  "completed_by" varchar(120),
  "completed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_gate_unique"
  ON "managed_payroll_gates" ("engagement_id", "gate_key");

CREATE TABLE IF NOT EXISTS "managed_payroll_run_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "engagement_id" integer NOT NULL REFERENCES "managed_payroll_engagements"("id") ON DELETE CASCADE,
  "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "approver_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by" varchar(120) NOT NULL,
  "payroll_fingerprint" varchar(64) NOT NULL,
  "approved_gross" numeric(14,2) NOT NULL,
  "approved_net" numeric(14,2) NOT NULL,
  "approved_employee_count" integer NOT NULL,
  "note" text,
  "approved_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_payroll_run_approval_unique"
  ON "managed_payroll_run_approvals" ("payroll_run_id");
