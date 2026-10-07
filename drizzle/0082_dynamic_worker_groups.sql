-- Dynamic Worker Groups / Supergroups: reusable live populations for Automation, WFM and enterprise controls.

CREATE TABLE IF NOT EXISTS "dynamic_worker_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" varchar(500),
  "conditions" jsonb NOT NULL DEFAULT '{"version":1,"all":[],"any":[]}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dynamic_worker_groups_org_code_unique"
  ON "dynamic_worker_groups" ("organization_id","code");

CREATE INDEX IF NOT EXISTS "dynamic_worker_groups_org_active_idx"
  ON "dynamic_worker_groups" ("organization_id","active","name");
