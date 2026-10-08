-- Non-destructive source-verified WFM/payroll review cases and human dead-letter triage.
-- No automation-created holds, roster changes, payroll approval/release or money movement.
CREATE TABLE IF NOT EXISTS "automation_operational_cases" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "case_type" varchar(40) NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "source_id" integer NOT NULL,
  "source_version" integer,
  "execution_id" integer REFERENCES "automation_executions"("id") ON DELETE SET NULL,
  "step_index" integer,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE SET NULL,
  "owner_team" varchar(60) NOT NULL,
  "title" varchar(180) NOT NULL,
  "detail" varchar(480) NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_by_name" varchar(120),
  "acknowledged_at" timestamptz,
  "resolved_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_by_name" varchar(120),
  "resolved_at" timestamptz,
  "resolution_note" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "automation_operations_case_type_check" CHECK ("case_type" IN ('coverage_recovery','timesheet_escalation','attendance_resolution','payroll_readiness','statutory_followup','execution_dead_letter')),
  CONSTRAINT "automation_operations_status_check" CHECK ("status" IN ('open','acknowledged','resolved')),
  CONSTRAINT "automation_operations_step_index_check" CHECK ("step_index" IS NULL OR "step_index" >= 0),
  CONSTRAINT "automation_operations_dead_letter_shape_check" CHECK ("case_type" <> 'execution_dead_letter' OR ("source_type" = 'automation_execution' AND "step_index" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_operations_source_case_unique"
  ON "automation_operational_cases" ("organization_id","case_type","source_id")
  WHERE "case_type" <> 'execution_dead_letter';
CREATE UNIQUE INDEX IF NOT EXISTS "automation_operations_dead_letter_step_unique"
  ON "automation_operational_cases" ("organization_id","source_id","step_index")
  WHERE "case_type" = 'execution_dead_letter';
CREATE INDEX IF NOT EXISTS "automation_operations_org_status_idx"
  ON "automation_operational_cases" ("organization_id","status","created_at");
CREATE INDEX IF NOT EXISTS "automation_operations_execution_idx"
  ON "automation_operational_cases" ("organization_id","execution_id");
