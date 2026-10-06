CREATE TABLE IF NOT EXISTS "pay_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "policy_kind" varchar(32) DEFAULT 'company' NOT NULL,
  "version" varchar(48) NOT NULL,
  "scope_type" varchar(24) DEFAULT 'organization' NOT NULL,
  "scope_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE cascade,
  "scope_employee_id" integer REFERENCES "employees"("id") ON DELETE cascade,
  "priority" integer DEFAULT 100 NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "active" boolean DEFAULT true NOT NULL,
  "description" text,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "approved_by" varchar(120),
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pay_policies_dates_check"
    CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from"),
  CONSTRAINT "pay_policies_scope_check"
    CHECK (
      ("scope_type" = 'organization' AND "scope_org_unit_id" IS NULL AND "scope_employee_id" IS NULL)
      OR ("scope_type" = 'org_unit' AND "scope_org_unit_id" IS NOT NULL AND "scope_employee_id" IS NULL)
      OR ("scope_type" = 'employee' AND "scope_employee_id" IS NOT NULL AND "scope_org_unit_id" IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "pay_policies_org_code_version_unique"
  ON "pay_policies" ("organization_id", "code", "version");

CREATE INDEX IF NOT EXISTS "pay_policies_org_effective_idx"
  ON "pay_policies" ("organization_id", "effective_from");

CREATE INDEX IF NOT EXISTS "pay_policies_scope_idx"
  ON "pay_policies" ("organization_id", "scope_type", "scope_org_unit_id", "scope_employee_id");

CREATE TABLE IF NOT EXISTS "pay_policy_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "policy_id" integer NOT NULL REFERENCES "pay_policies"("id") ON DELETE cascade,
  "rule_key" varchar(80) NOT NULL,
  "event_type" varchar(48) NOT NULL,
  "conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "statutory_floor_protected" boolean DEFAULT true NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "pay_policy_rules_policy_key_unique"
  ON "pay_policy_rules" ("policy_id", "rule_key");

CREATE INDEX IF NOT EXISTS "pay_policy_rules_policy_priority_idx"
  ON "pay_policy_rules" ("policy_id", "priority");
