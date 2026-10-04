CREATE TABLE IF NOT EXISTS "overtime_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "requested_minutes" integer NOT NULL,
  "reason" varchar(240) NOT NULL,
  "request_kind" varchar(32) DEFAULT 'pre_approved' NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "approval_task_id" integer,
  "requested_by" varchar(120) NOT NULL,
  "decided_by" varchar(120),
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "overtime_requests_org_date_idx"
  ON "overtime_requests" ("organization_id", "work_date");

CREATE INDEX IF NOT EXISTS "overtime_requests_employee_date_idx"
  ON "overtime_requests" ("employee_id", "work_date");

CREATE INDEX IF NOT EXISTS "overtime_requests_status_idx"
  ON "overtime_requests" ("organization_id", "status");
