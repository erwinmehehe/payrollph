CREATE TABLE IF NOT EXISTS "employee_availability_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "weekday" integer NOT NULL,
  "start_time" varchar(8) NOT NULL,
  "end_time" varchar(8) NOT NULL,
  "availability_type" varchar(24) DEFAULT 'unavailable' NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "notes" varchar(240),
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "employee_availability_employee_idx"
  ON "employee_availability_rules" ("organization_id", "employee_id", "weekday");
CREATE INDEX IF NOT EXISTS "employee_availability_effective_idx"
  ON "employee_availability_rules" ("organization_id", "effective_from");

CREATE TABLE IF NOT EXISTS "staffing_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE restrict,
  "required_headcount" integer NOT NULL,
  "notes" varchar(240),
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirement_unique"
  ON "staffing_requirements" ("organization_id", "worksite_id", "work_date", "shift_definition_id");
CREATE INDEX IF NOT EXISTS "staffing_requirement_date_idx"
  ON "staffing_requirements" ("organization_id", "work_date");

CREATE TABLE IF NOT EXISTS "open_shifts" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE cascade,
  "work_date" date NOT NULL,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE restrict,
  "slots" integer DEFAULT 1 NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "source_requirement_id" integer REFERENCES "staffing_requirements"("id") ON DELETE set null,
  "reason" varchar(240) DEFAULT 'Coverage gap' NOT NULL,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "open_shifts_org_date_idx"
  ON "open_shifts" ("organization_id", "work_date", "status");
CREATE INDEX IF NOT EXISTS "open_shifts_worksite_idx"
  ON "open_shifts" ("organization_id", "worksite_id", "work_date");

CREATE TABLE IF NOT EXISTS "open_shift_claims" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "open_shift_id" integer NOT NULL REFERENCES "open_shifts"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "reason" varchar(240) DEFAULT 'Open shift claim' NOT NULL,
  "requested_by" varchar(120) NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_by" varchar(120),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_claim_unique"
  ON "open_shift_claims" ("open_shift_id", "employee_id");
CREATE INDEX IF NOT EXISTS "open_shift_claim_org_status_idx"
  ON "open_shift_claims" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "open_shift_claim_employee_idx"
  ON "open_shift_claims" ("organization_id", "employee_id", "status");
