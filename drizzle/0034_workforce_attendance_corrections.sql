CREATE TABLE IF NOT EXISTS "attendance_correction_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "punch_id" integer NOT NULL REFERENCES "time_punches"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "original_punch_snapshot" jsonb NOT NULL,
  "proposed_punch_snapshot" jsonb NOT NULL,
  "reason" varchar(240) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requested_by" varchar(120) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "applied_at" timestamptz,
  "invalidated_payroll_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "attendance_corrections_org_status_idx"
  ON "attendance_correction_requests" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "attendance_corrections_employee_date_idx"
  ON "attendance_correction_requests" ("employee_id", "work_date");
CREATE INDEX IF NOT EXISTS "attendance_corrections_punch_idx"
  ON "attendance_correction_requests" ("punch_id");
