CREATE TABLE IF NOT EXISTS "compensation_bands" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE cascade,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "location_key" varchar(80) DEFAULT 'company' NOT NULL,
  "currency" varchar(8) DEFAULT 'PHP' NOT NULL,
  "minimum_monthly" numeric(14,2) NOT NULL,
  "midpoint_monthly" numeric(14,2) NOT NULL,
  "maximum_monthly" numeric(14,2) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_profile_location_unique"
  ON "compensation_bands" ("organization_id","job_profile_id","location_key");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_active_idx"
  ON "compensation_bands" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "compensation_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "effective_date" date NOT NULL,
  "total_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_cycles_org_name_effective_unique"
  ON "compensation_cycles" ("organization_id","name","effective_date");
CREATE INDEX IF NOT EXISTS "compensation_cycles_org_status_idx"
  ON "compensation_cycles" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "compensation_budget_pools" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "compensation_cycles"("id") ON DELETE cascade,
  "org_unit_id" integer NOT NULL REFERENCES "org_units"("id") ON DELETE cascade,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_budget_pools_cycle_unit_unique"
  ON "compensation_budget_pools" ("cycle_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "compensation_budget_pools_org_cycle_idx"
  ON "compensation_budget_pools" ("organization_id","cycle_id");

CREATE TABLE IF NOT EXISTS "compensation_recommendations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "compensation_cycles"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "band_id" integer REFERENCES "compensation_bands"("id") ON DELETE set null,
  "performance_review_id" integer REFERENCES "performance_reviews"("id") ON DELETE set null,
  "adjustment_type" varchar(32) DEFAULT 'merit' NOT NULL,
  "current_monthly_rate" numeric(14,2) NOT NULL,
  "proposed_monthly_rate" numeric(14,2) NOT NULL,
  "annualized_increase" numeric(14,2) DEFAULT '0' NOT NULL,
  "rationale" text,
  "band_exception_reason" text,
  "status" varchar(24) DEFAULT 'submitted' NOT NULL,
  "proposed_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "applied_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "applied_pay_revision_id" integer REFERENCES "employee_pay_revisions"("id") ON DELETE set null,
  "approved_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_recommendations_cycle_employee_unique"
  ON "compensation_recommendations" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "compensation_recommendations_org_status_idx"
  ON "compensation_recommendations" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "compensation_recommendations_cycle_idx"
  ON "compensation_recommendations" ("cycle_id");
