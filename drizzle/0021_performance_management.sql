CREATE TABLE IF NOT EXISTS "performance_cycles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "performance_cycles_org_status_idx" ON "performance_cycles" ("organization_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "performance_cycles_org_name_dates_unique" ON "performance_cycles" ("organization_id","name","start_date","end_date");

CREATE TABLE IF NOT EXISTS "performance_goals" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cycle_id" integer REFERENCES "performance_cycles"("id") ON DELETE set null,
  "title" varchar(180) NOT NULL,
  "description" text,
  "weight" numeric(5,2) DEFAULT '0' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "due_date" date,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "performance_goals_org_employee_idx" ON "performance_goals" ("organization_id","employee_id");
CREATE INDEX IF NOT EXISTS "performance_goals_cycle_idx" ON "performance_goals" ("cycle_id");

CREATE TABLE IF NOT EXISTS "performance_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE cascade,
  "reviewer_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "self_score" numeric(4,2),
  "manager_score" numeric(4,2),
  "final_score" numeric(4,2),
  "employee_reflection" text,
  "manager_summary" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_reviews_cycle_employee_unique" ON "performance_reviews" ("cycle_id","employee_id");
CREATE INDEX IF NOT EXISTS "performance_reviews_org_employee_idx" ON "performance_reviews" ("organization_id","employee_id");
