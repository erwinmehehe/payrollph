CREATE TABLE IF NOT EXISTS "compliance_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "rule_key" varchar(80) NOT NULL,
  "agency" varchar(40) NOT NULL,
  "jurisdiction" varchar(80) DEFAULT 'PH' NOT NULL,
  "region" varchar(40) DEFAULT 'ALL' NOT NULL,
  "rule_version" varchar(64) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "source_document" varchar(240) NOT NULL,
  "source_url" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "future_effective" boolean DEFAULT false NOT NULL,
  "reviewed_by" varchar(120),
  "approved_by" varchar(120),
  "approved_at" timestamptz,
  "supersedes_rule_version" varchar(64),
  "rollback_version" varchar(64),
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "compliance_rules_version_unique"
  ON "compliance_rules" ("rule_key", "jurisdiction", "region", "rule_version");

CREATE INDEX IF NOT EXISTS "compliance_rules_effective_idx"
  ON "compliance_rules" ("rule_key", "jurisdiction", "region", "effective_from");

CREATE INDEX IF NOT EXISTS "compliance_rules_status_idx"
  ON "compliance_rules" ("status", "effective_from");
