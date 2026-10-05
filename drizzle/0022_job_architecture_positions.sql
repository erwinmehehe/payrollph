CREATE TABLE IF NOT EXISTS "job_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "title" varchar(160) NOT NULL,
  "family" varchar(120) DEFAULT 'General' NOT NULL,
  "level" varchar(80) DEFAULT 'Individual Contributor' NOT NULL,
  "grade" varchar(40),
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_profiles_org_title_level_unique" ON "job_profiles" ("organization_id","title","level");
CREATE INDEX IF NOT EXISTS "job_profiles_org_active_idx" ON "job_profiles" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "workforce_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plans_org_name_dates_unique" ON "workforce_plans" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "workforce_plans_org_status_idx" ON "workforce_plans" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(48) NOT NULL,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "employment_type" varchar(32) DEFAULT 'Regular' NOT NULL,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "planned_start_date" date,
  "annual_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "positions_org_code_unique" ON "positions" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "positions_org_status_idx" ON "positions" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "positions_org_unit_idx" ON "positions" ("organization_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_plan_idx" ON "positions" ("plan_id");

CREATE TABLE IF NOT EXISTS "position_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) DEFAULT 'Position assignment' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_position_from_unique" ON "position_assignments" ("position_id","effective_from");
CREATE INDEX IF NOT EXISTS "position_assignments_employee_idx" ON "position_assignments" ("organization_id","employee_id");
