-- Governed compensation bands and review cycles.
CREATE TABLE IF NOT EXISTS "compensation_bands" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "location_code" varchar(80) DEFAULT 'PH' NOT NULL,
  "currency" varchar(8) DEFAULT 'PHP' NOT NULL,
  "minimum_annual" numeric(14,2) NOT NULL,
  "midpoint_annual" numeric(14,2) NOT NULL,
  "maximum_annual" numeric(14,2) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_bands_org_profile_location_unique"
  ON "compensation_bands" ("organization_id","job_profile_id","location_code");
CREATE INDEX IF NOT EXISTS "compensation_bands_org_active_idx"
  ON "compensation_bands" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "compensation_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "effective_date" date NOT NULL,
  "budget_pool" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_cycles_org_name_dates_unique"
  ON "compensation_cycles" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "compensation_cycles_org_status_idx"
  ON "compensation_cycles" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "compensation_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "compensation_cycles"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "band_id" integer NOT NULL REFERENCES "compensation_bands"("id") ON DELETE restrict,
  "current_annual" numeric(14,2) NOT NULL,
  "proposed_annual" numeric(14,2) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "status" varchar(24) DEFAULT 'proposed' NOT NULL,
  "submitted_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamptz,
  "applied_pay_revision_id" integer REFERENCES "employee_pay_revisions"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_proposals_cycle_employee_unique"
  ON "compensation_proposals" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "compensation_proposals_org_status_idx"
  ON "compensation_proposals" ("organization_id","status");
