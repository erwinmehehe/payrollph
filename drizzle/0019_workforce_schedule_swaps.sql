CREATE TABLE IF NOT EXISTS "schedule_swap_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "requester_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "counterparty_employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "requester_work_date" date NOT NULL,
  "counterparty_work_date" date NOT NULL,
  "requester_schedule_snapshot" jsonb NOT NULL,
  "counterparty_schedule_snapshot" jsonb NOT NULL,
  "reason" varchar(240) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requested_by" varchar(120) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "schedule_swap_requests_org_status_idx"
  ON "schedule_swap_requests" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "schedule_swap_requests_requester_date_idx"
  ON "schedule_swap_requests" ("requester_employee_id", "requester_work_date");

CREATE INDEX IF NOT EXISTS "schedule_swap_requests_counterparty_date_idx"
  ON "schedule_swap_requests" ("counterparty_employee_id", "counterparty_work_date");
