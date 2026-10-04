CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(140) NOT NULL,
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_org_code_unique"
  ON "cost_centers" ("organization_id", "code");

CREATE INDEX IF NOT EXISTS "cost_centers_org_active_idx"
  ON "cost_centers" ("organization_id", "active");

CREATE TABLE IF NOT EXISTS "employee_labor_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cost_center_id" integer NOT NULL REFERENCES "cost_centers"("id") ON DELETE restrict,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "allocation_percent" numeric(6,3) NOT NULL,
  "allocation_basis" varchar(24) DEFAULT 'percentage' NOT NULL,
  "project_code" varchar(64),
  "client_code" varchar(64),
  "job_code" varchar(64),
  "reason" varchar(240) DEFAULT 'Labor costing allocation' NOT NULL,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "employee_labor_allocations_percent_check"
    CHECK ("allocation_percent" > 0 AND "allocation_percent" <= 100),
  CONSTRAINT "employee_labor_allocations_basis_check"
    CHECK ("allocation_basis" = 'percentage'),
  CONSTRAINT "employee_labor_allocations_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);

CREATE INDEX IF NOT EXISTS "employee_labor_allocations_employee_date_idx"
  ON "employee_labor_allocations" ("employee_id", "effective_from");

CREATE INDEX IF NOT EXISTS "employee_labor_allocations_org_cost_center_idx"
  ON "employee_labor_allocations" ("organization_id", "cost_center_id");
