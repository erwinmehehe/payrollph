CREATE TABLE IF NOT EXISTS "worker_effective_changes" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "change_type" varchar(32) DEFAULT 'job_change' NOT NULL,
  "movement_type" varchar(24) DEFAULT 'job_change' NOT NULL,
  "effective_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'pending_approval' NOT NULL,
  "target_position_id" integer REFERENCES "positions"("id") ON DELETE restrict,
  "target_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  "target_cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE restrict,
  "target_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE restrict,
  "target_employment_type" varchar(32),
  "target_employee_status" varchar(32),
  "target_fte" numeric(5,4),
  "reason" varchar(240) NOT NULL,
  "from_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "to_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "applied_event_id" integer REFERENCES "worker_employment_events"("id") ON DELETE set null,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamp with time zone,
  "failure" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "worker_effective_changes_org_status_date_idx"
  ON "worker_effective_changes" ("organization_id","status","effective_date");
CREATE INDEX IF NOT EXISTS "worker_effective_changes_employee_date_idx"
  ON "worker_effective_changes" ("organization_id","employee_id","effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_employee_unique"
  ON "worker_effective_changes" ("organization_id","employee_id")
  WHERE "status" IN ('pending_approval','scheduled');
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_target_position_unique"
  ON "worker_effective_changes" ("target_position_id")
  WHERE "target_position_id" IS NOT NULL
    AND "status" IN ('pending_approval','scheduled');
