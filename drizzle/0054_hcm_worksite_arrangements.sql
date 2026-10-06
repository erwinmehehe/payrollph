-- Effective-dated HCM work arrangements and secondary worksite access
CREATE TABLE IF NOT EXISTS "hcm_work_arrangements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "mode" varchar(20) NOT NULL CHECK ("mode" IN ('onsite','hybrid','remote','field')),
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_work_arrangement_valid_dates" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_work_arrangement_employee_effective_unique" ON "hcm_work_arrangements" ("employee_id","effective_from");
CREATE INDEX IF NOT EXISTS "hcm_work_arrangements_employee_dates_idx" ON "hcm_work_arrangements" ("organization_id","employee_id","effective_from");
CREATE TABLE IF NOT EXISTS "hcm_worksite_authorizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE restrict,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) NOT NULL,
  "authorized_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "authorized_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_worksite_authorization_valid_dates" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_worksite_authorization_unique" ON "hcm_worksite_authorizations" ("employee_id","worksite_id","effective_from");
CREATE INDEX IF NOT EXISTS "hcm_worksite_authorizations_effective_idx" ON "hcm_worksite_authorizations" ("organization_id","employee_id","effective_from");
