CREATE TABLE IF NOT EXISTS "statutory_remittance_month_closures" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "applicable_month" varchar(7) NOT NULL,
  "status" varchar(24) DEFAULT 'certified' NOT NULL,
  "snapshot_hash" varchar(64) NOT NULL,
  "certified_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "certified_by_name" varchar(120) NOT NULL,
  "certified_at" timestamptz DEFAULT now() NOT NULL,
  "invalidated_at" timestamptz,
  "invalidation_reason" varchar(280),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "statutory_remittance_month_closure_unique"
  ON "statutory_remittance_month_closures" ("organization_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "statutory_remittance_month_closure_status_idx"
  ON "statutory_remittance_month_closures" ("organization_id", "status");
