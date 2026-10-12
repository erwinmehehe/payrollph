-- Internal HR request/helpdesk; all records are employer-scoped.
CREATE TABLE IF NOT EXISTS "employee_hr_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "case_type" varchar(32) NOT NULL,
  "subject" varchar(160) NOT NULL,
  "description" text NOT NULL,
  "assigned_role" varchar(24) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "sla_due_at" timestamp with time zone NOT NULL,
  "coe_document_id" integer REFERENCES "documents"("id"),
  "coe_approved_by_user_id" integer REFERENCES "users"("id"),
  "coe_approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_hr_cases_status_check" CHECK ("status" in ('open','in_progress','waiting_employee','resolved','closed'))
);
CREATE INDEX IF NOT EXISTS "employee_hr_cases_employee_idx"
  ON "employee_hr_cases" ("organization_id", "employee_id", "created_at");
CREATE INDEX IF NOT EXISTS "employee_hr_cases_sla_idx"
  ON "employee_hr_cases" ("organization_id", "status", "sla_due_at");
CREATE TABLE IF NOT EXISTS "employee_hr_case_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "case_id" integer NOT NULL REFERENCES "employee_hr_cases"("id") ON DELETE CASCADE,
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "visibility" varchar(16) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_hr_case_messages_visibility_check" CHECK ("visibility" in ('employee','internal'))
);
CREATE INDEX IF NOT EXISTS "employee_hr_case_messages_case_idx"
  ON "employee_hr_case_messages" ("organization_id", "case_id", "created_at");
