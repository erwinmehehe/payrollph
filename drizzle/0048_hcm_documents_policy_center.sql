CREATE TABLE IF NOT EXISTS "hcm_policy_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_code" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "category" varchar(60) NOT NULL DEFAULT 'company_policy',
  "version" varchar(48) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'draft',
  "effective_from" date NOT NULL,
  "effective_until" date,
  "target_conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "requires_acknowledgement" boolean NOT NULL DEFAULT true,
  "acknowledgement_due_days" integer NOT NULL DEFAULT 7,
  "source_document_id" integer REFERENCES "documents"("id") ON DELETE set null,
  "content" text NOT NULL DEFAULT '',
  "content_sha256" varchar(64) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by_name" varchar(120),
  "approved_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_policy_version_unique" ON "hcm_policy_versions" ("organization_id","policy_code","version");
CREATE INDEX IF NOT EXISTS "hcm_policy_status_effective_idx" ON "hcm_policy_versions" ("organization_id","status","effective_from");

CREATE TABLE IF NOT EXISTS "hcm_policy_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "hcm_policy_versions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "due_at" timestamp with time zone,
  "status" varchar(24) NOT NULL DEFAULT 'assigned',
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "acknowledgement_sha256" varchar(64),
  "acknowledgement_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "waived_at" timestamp with time zone,
  "waived_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "waived_by_name" varchar(120),
  "waiver_reason" varchar(240),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_policy_assignment_unique" ON "hcm_policy_assignments" ("policy_id","employee_id");
CREATE INDEX IF NOT EXISTS "hcm_policy_assignment_employee_idx" ON "hcm_policy_assignments" ("organization_id","employee_id","status");
CREATE INDEX IF NOT EXISTS "hcm_policy_assignment_due_idx" ON "hcm_policy_assignments" ("organization_id","status","due_at");

CREATE TABLE IF NOT EXISTS "hcm_document_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(80) NOT NULL,
  "name" varchar(180) NOT NULL,
  "kind" varchar(40) NOT NULL,
  "target_conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "mandatory" boolean NOT NULL DEFAULT true,
  "expiry_required" boolean NOT NULL DEFAULT false,
  "submission_due_days" integer NOT NULL DEFAULT 14,
  "renewal_lead_days" integer NOT NULL DEFAULT 30,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_document_requirement_unique" ON "hcm_document_requirements" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "hcm_document_requirement_active_idx" ON "hcm_document_requirements" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "hcm_employee_document_compliance" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "requirement_id" integer NOT NULL REFERENCES "hcm_document_requirements"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "document_id" integer REFERENCES "documents"("id") ON DELETE set null,
  "status" varchar(24) NOT NULL DEFAULT 'missing',
  "due_at" date,
  "expires_at" date,
  "verified_at" timestamp with time zone,
  "verified_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "verified_by_name" varchar(120),
  "waived_at" timestamp with time zone,
  "waived_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "waived_by_name" varchar(120),
  "waiver_reason" varchar(240),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employee_document_requirement_unique" ON "hcm_employee_document_compliance" ("requirement_id","employee_id");
CREATE INDEX IF NOT EXISTS "hcm_employee_document_status_idx" ON "hcm_employee_document_compliance" ("organization_id","employee_id","status");
CREATE INDEX IF NOT EXISTS "hcm_employee_document_expiry_idx" ON "hcm_employee_document_compliance" ("organization_id","status","expires_at");
