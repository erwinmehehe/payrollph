CREATE TABLE IF NOT EXISTS "compliance_action_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "source_type" varchar(48) NOT NULL,
  "source_key" varchar(120) NOT NULL,
  "agency" varchar(24),
  "applicable_month" varchar(7),
  "severity" varchar(16) NOT NULL,
  "title" varchar(180) NOT NULL,
  "detail" varchar(360) NOT NULL,
  "due_date" date,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "assigned_to_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "assigned_to_name" varchar(120),
  "acknowledged_at" timestamptz,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "acknowledged_by_name" varchar(120),
  "first_detected_at" timestamptz DEFAULT now() NOT NULL,
  "last_detected_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "compliance_action_source_unique"
  ON "compliance_action_tasks" ("organization_id", "source_type", "source_key");
CREATE INDEX IF NOT EXISTS "compliance_action_status_idx"
  ON "compliance_action_tasks" ("organization_id", "status", "severity");
CREATE INDEX IF NOT EXISTS "compliance_action_assignee_idx"
  ON "compliance_action_tasks" ("organization_id", "assigned_to_user_id", "status");
