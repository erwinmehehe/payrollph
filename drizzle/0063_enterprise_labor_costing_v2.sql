CREATE TABLE IF NOT EXISTS "labor_hour_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities"("id") ON DELETE restrict,
  "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cost_center_id" integer NOT NULL REFERENCES "cost_centers"("id") ON DELETE restrict,
  "work_date" date NOT NULL,
  "minutes" integer NOT NULL,
  "project_code" varchar(64),
  "client_code" varchar(64),
  "job_code" varchar(64),
  "source_type" varchar(24) DEFAULT 'manual' NOT NULL,
  "source_reference" varchar(160),
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "labor_hour_allocations_minutes_check"
    CHECK ("minutes" > 0 AND "minutes" <= 2880),
  CONSTRAINT "labor_hour_allocations_source_check"
    CHECK ("source_type" IN ('attendance', 'timesheet', 'manual', 'import'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "labor_hour_allocation_dimension_unique"
  ON "labor_hour_allocations" (
    "payroll_run_id",
    "employee_id",
    "work_date",
    "cost_center_id",
    COALESCE("project_code", ''),
    COALESCE("client_code", ''),
    COALESCE("job_code", '')
  );

CREATE INDEX IF NOT EXISTS "labor_hour_allocations_run_employee_idx"
  ON "labor_hour_allocations" ("organization_id", "payroll_run_id", "employee_id", "work_date");

CREATE INDEX IF NOT EXISTS "labor_hour_allocations_cost_center_idx"
  ON "labor_hour_allocations" ("organization_id", "legal_entity_id", "cost_center_id", "work_date");

CREATE TABLE IF NOT EXISTS "labor_gl_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities"("id") ON DELETE restrict,
  "cost_center_id" integer NOT NULL REFERENCES "cost_centers"("id") ON DELETE restrict,
  "component" varchar(32) NOT NULL,
  "gl_account_code" varchar(40) NOT NULL,
  "gl_account_name" varchar(160) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "labor_gl_mappings_component_check"
    CHECK ("component" IN ('gross_pay', 'employer_sss', 'employer_ec', 'employer_philhealth', 'employer_pagibig')),
  CONSTRAINT "labor_gl_mappings_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);

CREATE UNIQUE INDEX IF NOT EXISTS "labor_gl_mapping_effective_unique"
  ON "labor_gl_mappings" ("legal_entity_id", "cost_center_id", "component", "effective_from");

CREATE INDEX IF NOT EXISTS "labor_gl_mappings_scope_idx"
  ON "labor_gl_mappings" ("organization_id", "legal_entity_id", "cost_center_id", "component", "active");
