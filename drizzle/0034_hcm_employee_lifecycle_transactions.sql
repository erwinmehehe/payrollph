CREATE TABLE IF NOT EXISTS "employee_lifecycle_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "change_type" varchar(32) NOT NULL,
  "effective_date" date NOT NULL,
  "target_position_id" integer REFERENCES "positions"("id") ON DELETE restrict,
  "target_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "target_employment_type" varchar(32),
  "reason" varchar(320) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "before_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "applied_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by_name" varchar(120) NOT NULL,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by_name" varchar(120),
  "decided_at" timestamptz,
  "decision_note" varchar(320),
  "applied_at" timestamptz,
  "applied_by" varchar(120),
  "apply_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "employee_lifecycle_org_status_idx"
  ON "employee_lifecycle_transactions" ("organization_id", "status", "effective_date");
CREATE INDEX IF NOT EXISTS "employee_lifecycle_employee_idx"
  ON "employee_lifecycle_transactions" ("organization_id", "employee_id", "status");
CREATE INDEX IF NOT EXISTS "employee_lifecycle_target_position_idx"
  ON "employee_lifecycle_transactions" ("target_position_id", "status");
