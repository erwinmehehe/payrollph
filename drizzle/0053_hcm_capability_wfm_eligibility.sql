-- HCM capability and workforce eligibility
CREATE TABLE IF NOT EXISTS "hcm_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "category" varchar(80) NOT NULL DEFAULT 'General',
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_skills_org_code_unique" ON "hcm_skills" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "hcm_skills_org_active_idx" ON "hcm_skills" ("organization_id","active","category");

CREATE TABLE IF NOT EXISTS "hcm_job_profile_skill_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "hcm_skills"("id") ON DELETE restrict,
  "minimum_proficiency" integer NOT NULL DEFAULT 1 CHECK ("minimum_proficiency" BETWEEN 1 AND 5),
  "mandatory" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_job_profile_skill_unique" ON "hcm_job_profile_skill_requirements" ("job_profile_id","skill_id");
CREATE INDEX IF NOT EXISTS "hcm_job_profile_skill_profile_idx" ON "hcm_job_profile_skill_requirements" ("organization_id","job_profile_id");

CREATE TABLE IF NOT EXISTS "hcm_employee_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "hcm_skills"("id") ON DELETE restrict,
  "proficiency" integer NOT NULL DEFAULT 1 CHECK ("proficiency" BETWEEN 1 AND 5),
  "status" varchar(24) NOT NULL DEFAULT 'declared' CHECK ("status" IN ('declared','verified','revoked')),
  "effective_from" date NOT NULL,
  "effective_until" date,
  "verified_at" timestamptz,
  "verified_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "verified_by_name" varchar(120),
  "notes" varchar(240),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hcm_employee_skill_dates_check" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employee_skill_effective_unique" ON "hcm_employee_skills" ("employee_id","skill_id","effective_from");
CREATE INDEX IF NOT EXISTS "hcm_employee_skill_employee_idx" ON "hcm_employee_skills" ("organization_id","employee_id","status");
CREATE INDEX IF NOT EXISTS "hcm_employee_skill_date_idx" ON "hcm_employee_skills" ("organization_id","skill_id","effective_from");

CREATE TABLE IF NOT EXISTS "hcm_job_profile_credential_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE cascade,
  "document_requirement_id" integer NOT NULL REFERENCES "hcm_document_requirements"("id") ON DELETE cascade,
  "mandatory" boolean NOT NULL DEFAULT true,
  "blocks_workforce_eligibility" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_job_profile_credential_unique" ON "hcm_job_profile_credential_requirements" ("job_profile_id","document_requirement_id");
CREATE INDEX IF NOT EXISTS "hcm_job_profile_credential_profile_idx" ON "hcm_job_profile_credential_requirements" ("organization_id","job_profile_id");
