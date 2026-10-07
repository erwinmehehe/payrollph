-- Automation Studio governance: immutable rule-definition versions with staged publish/rollback.
-- The automation_rules row remains the live execution snapshot for backward compatibility.

ALTER TABLE "automation_rules"
  ADD COLUMN IF NOT EXISTS "published_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "draft_version" integer,
  ADD COLUMN IF NOT EXISTS "published_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "published_by_user_id" integer REFERENCES "users"("id") ON DELETE set null;

CREATE TABLE IF NOT EXISTS "automation_rule_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "rule_id" integer NOT NULL REFERENCES "automation_rules"("id") ON DELETE cascade,
  "version" integer NOT NULL CHECK ("version" > 0),
  "trigger" varchar(64) NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_rule_versions_rule_version_unique"
  ON "automation_rule_versions" ("rule_id","version");

CREATE INDEX IF NOT EXISTS "automation_rule_versions_org_rule_idx"
  ON "automation_rule_versions" ("organization_id","rule_id","version");

INSERT INTO "automation_rule_versions" (
  "organization_id",
  "rule_id",
  "version",
  "trigger",
  "conditions",
  "actions",
  "created_by_user_id",
  "created_by_name",
  "created_at"
)
SELECT
  "organization_id",
  "id",
  1,
  "trigger",
  "conditions",
  "actions",
  "created_by_user_id",
  'Migration backfill',
  COALESCE("updated_at","created_at",now())
FROM "automation_rules"
ON CONFLICT ("rule_id","version") DO NOTHING;

UPDATE "automation_rules"
SET
  "published_version" = COALESCE("published_version",1),
  "published_at" = COALESCE("published_at","updated_at","created_at",now())
WHERE "published_at" IS NULL;
