CREATE TABLE IF NOT EXISTS "payroll_release_holds" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "payroll_run_id" integer NOT NULL,
  "source_type" varchar(32) DEFAULT 'automation' NOT NULL,
  "source_key" varchar(180) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "placed_by" varchar(120) NOT NULL,
  "placed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cleared_by_user_id" integer,
  "cleared_by" varchar(120),
  "cleared_at" timestamp with time zone,
  "clearance_note" varchar(500),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_release_holds_status_check" CHECK ("payroll_release_holds"."status" in ('active','cleared'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_release_holds" ADD CONSTRAINT "payroll_release_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_release_holds" ADD CONSTRAINT "payroll_release_holds_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_release_holds" ADD CONSTRAINT "payroll_release_holds_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_release_holds_source_unique" ON "payroll_release_holds" USING btree ("payroll_run_id","source_type","source_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_release_holds_active_idx" ON "payroll_release_holds" USING btree ("organization_id","payroll_run_id","status");
