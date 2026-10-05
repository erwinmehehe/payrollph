CREATE TABLE IF NOT EXISTS "skill_catalog" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "category" varchar(100) DEFAULT 'General' NOT NULL,
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "skill_catalog_org_name_unique" ON "skill_catalog" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "skill_catalog_org_active_idx" ON "skill_catalog" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "job_profile_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "skill_catalog"("id") ON DELETE cascade,
  "required_level" integer DEFAULT 3 NOT NULL,
  "critical" boolean DEFAULT false NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_profile_skills_profile_skill_unique" ON "job_profile_skills" ("job_profile_id","skill_id");
CREATE INDEX IF NOT EXISTS "job_profile_skills_org_profile_idx" ON "job_profile_skills" ("organization_id","job_profile_id");

CREATE TABLE IF NOT EXISTS "employee_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "skill_catalog"("id") ON DELETE cascade,
  "proficiency_level" integer DEFAULT 1 NOT NULL,
  "source" varchar(32) DEFAULT 'manager' NOT NULL,
  "verified_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "verified_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_skills_employee_skill_unique" ON "employee_skills" ("employee_id","skill_id");
CREATE INDEX IF NOT EXISTS "employee_skills_org_employee_idx" ON "employee_skills" ("organization_id","employee_id");

CREATE TABLE IF NOT EXISTS "development_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "performance_review_id" integer REFERENCES "performance_reviews"("id") ON DELETE set null,
  "title" varchar(180) NOT NULL,
  "target_date" date,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "development_plans_org_employee_idx" ON "development_plans" ("organization_id","employee_id");
CREATE INDEX IF NOT EXISTS "development_plans_review_idx" ON "development_plans" ("performance_review_id");

CREATE TABLE IF NOT EXISTS "development_plan_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "plan_id" integer NOT NULL REFERENCES "development_plans"("id") ON DELETE cascade,
  "skill_id" integer REFERENCES "skill_catalog"("id") ON DELETE set null,
  "title" varchar(180) NOT NULL,
  "activity_type" varchar(40) DEFAULT 'training' NOT NULL,
  "target_level" integer,
  "due_date" date,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "development_plan_items_plan_idx" ON "development_plan_items" ("plan_id");
CREATE INDEX IF NOT EXISTS "development_plan_items_org_skill_idx" ON "development_plan_items" ("organization_id","skill_id");

CREATE TABLE IF NOT EXISTS "learning_courses" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(48) NOT NULL,
  "title" varchar(180) NOT NULL,
  "provider" varchar(160) DEFAULT 'Internal' NOT NULL,
  "delivery_mode" varchar(40) DEFAULT 'self_paced' NOT NULL,
  "description" text,
  "skill_id" integer REFERENCES "skill_catalog"("id") ON DELETE set null,
  "awarded_level" integer,
  "certification_name" varchar(180),
  "validity_months" integer,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "learning_courses_org_code_unique" ON "learning_courses" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "learning_courses_org_active_idx" ON "learning_courses" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "learning_enrollments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "course_id" integer NOT NULL REFERENCES "learning_courses"("id") ON DELETE cascade,
  "development_plan_item_id" integer REFERENCES "development_plan_items"("id") ON DELETE set null,
  "status" varchar(24) DEFAULT 'assigned' NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_date" date,
  "completed_at" timestamp with time zone,
  "score" numeric(5,2),
  "evidence_url" text,
  "assigned_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "learning_enrollments_employee_course_unique" ON "learning_enrollments" ("employee_id","course_id");
CREATE INDEX IF NOT EXISTS "learning_enrollments_org_status_idx" ON "learning_enrollments" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "employee_certifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "skill_id" integer REFERENCES "skill_catalog"("id") ON DELETE set null,
  "name" varchar(180) NOT NULL,
  "issuer" varchar(160) DEFAULT 'Internal' NOT NULL,
  "credential_id" varchar(160),
  "issued_on" date NOT NULL,
  "expires_on" date,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "evidence_url" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "employee_certifications_org_employee_idx" ON "employee_certifications" ("organization_id","employee_id");
CREATE INDEX IF NOT EXISTS "employee_certifications_expiry_idx" ON "employee_certifications" ("organization_id","expires_on");
