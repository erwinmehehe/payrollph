-- HMO benefits administration + automation event support.
-- Extends the existing benefit plan/enrolment model instead of creating a parallel benefits system.

ALTER TABLE "benefit_plans"
  ADD COLUMN IF NOT EXISTS "plan_code" varchar(48),
  ADD COLUMN IF NOT EXISTS "contract_number" varchar(80),
  ADD COLUMN IF NOT EXISTS "contract_start" date,
  ADD COLUMN IF NOT EXISTS "contract_end" date,
  ADD COLUMN IF NOT EXISTS "annual_benefit_limit" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "dependent_share" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "employer_paid_dependents" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "waiting_period_days" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "coverage_details" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "benefit_enrollments"
  ADD COLUMN IF NOT EXISTS "provider_status" varchar(32) NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS "provider_member_id" varchar(80),
  ADD COLUMN IF NOT EXISTS "effective_on" date;

UPDATE "benefit_enrollments"
SET "effective_on" = "started_on"
WHERE "effective_on" IS NULL;

CREATE TABLE IF NOT EXISTS "benefit_dependents" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "enrollment_id" integer NOT NULL REFERENCES "benefit_enrollments"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "relationship" varchar(32) NOT NULL,
  "birth_date" date NOT NULL,
  "sex" varchar(24),
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "monthly_contribution" numeric(10,2) NOT NULL DEFAULT 0,
  "provider_member_id" varchar(80),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "benefit_dependents_enrollment_identity_unique"
  ON "benefit_dependents" ("enrollment_id", "name", "birth_date");

CREATE INDEX IF NOT EXISTS "benefit_dependents_org_employee_idx"
  ON "benefit_dependents" ("organization_id", "employee_id", "status");

CREATE TABLE IF NOT EXISTS "benefit_enrollment_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "enrollment_id" integer NOT NULL REFERENCES "benefit_enrollments"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(48) NOT NULL,
  "status" varchar(32),
  "note" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "benefit_enrollment_events_enrollment_idx"
  ON "benefit_enrollment_events" ("organization_id", "enrollment_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "benefit_enrollment_events_employee_idx"
  ON "benefit_enrollment_events" ("organization_id", "employee_id", "created_at" DESC);
