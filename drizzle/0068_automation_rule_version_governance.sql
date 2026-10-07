-- Automation Studio version governance: draft, publish, rollback and immutable history.

ALTER TABLE "automation_rules"
  ADD COLUMN IF NOT EXISTS "published_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "draft_version" integer;

CREATE TABLE IF NOT EXISTS "automation_rule_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "rule_id" integer NOT NULL REFERENCES "automation_rules"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft','published','superseded')),
  "name" varchar(160) NOT NULL,
  "trigger" varchar(64) NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "source_version" integer,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "published_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_rule_versions_rule_version_unique"
  ON "automation_rule_versions" ("rule_id","version");

CREATE UNIQUE INDEX IF NOT EXISTS "automation_rule_versions_one_draft_unique"
  ON "automation_rule_versions" ("rule_id")
  WHERE "status" = 'draft';

CREATE INDEX IF NOT EXISTS "automation_rule_versions_org_rule_idx"
  ON "automation_rule_versions" ("organization_id","rule_id","version");

INSERT INTO "automation_rule_versions" (
  "organization_id","rule_id","version","status","name","trigger",
  "conditions","actions","active","created_by_user_id","created_at",
  "published_by_user_id","published_at"
)
SELECT
  r."organization_id", r."id", 1, 'published', r."name", r."trigger",
  r."conditions", r."actions", r."active", r."created_by_user_id", r."created_at",
  r."created_by_user_id", r."updated_at"
FROM "automation_rules" r
WHERE NOT EXISTS (
  SELECT 1 FROM "automation_rule_versions" v WHERE v."rule_id" = r."id"
);

UPDATE "automation_rules"
SET "published_version" = 1
WHERE "published_version" IS NULL OR "published_version" < 1;
