-- Governed company payout profiles and honest bank-adapter lifecycle metadata.

ALTER TABLE "bank_templates"
  ADD COLUMN IF NOT EXISTS "bank_code" varchar(32),
  ADD COLUMN IF NOT EXISTS "product_name" varchar(120),
  ADD COLUMN IF NOT EXISTS "adapter_stage" varchar(24) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "spec_source" varchar(24) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "spec_reference" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "bank_templates_name_version_unique"
  ON "bank_templates" ("name","version");

CREATE INDEX IF NOT EXISTS "bank_templates_bank_stage_idx"
  ON "bank_templates" ("bank_code","adapter_stage");

ALTER TABLE "bank_templates"
  DROP CONSTRAINT IF EXISTS "bank_templates_adapter_stage_check";
ALTER TABLE "bank_templates"
  ADD CONSTRAINT "bank_templates_adapter_stage_check"
  CHECK ("adapter_stage" IN ('draft','spec_obtained','mapping_ready','uat_ready','portal_validated','production_proven'));

ALTER TABLE "bank_templates"
  DROP CONSTRAINT IF EXISTS "bank_templates_spec_source_check";
ALTER TABLE "bank_templates"
  ADD CONSTRAINT "bank_templates_spec_source_check"
  CHECK ("spec_source" IN ('unknown','bank_provided','provider_provided','official_public','internal_demo'));

CREATE TABLE IF NOT EXISTS "payout_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities"("id") ON DELETE cascade,
  "bank_template_id" integer REFERENCES "bank_templates"("id") ON DELETE set null,
  "default_method" varchar(24) NOT NULL DEFAULT 'bank_file',
  "bank_product" varchar(120),
  "source_account_type" varchar(32),
  "company_code" varchar(80),
  "presenting_office" varchar(80),
  "branch_code" varchar(32),
  "remarks" varchar(240),
  "max_amount_per_file" numeric(16,2),
  "max_rows_per_file" integer,
  "transaction_limit" numeric(16,2),
  "daily_limit" numeric(16,2),
  "active" boolean NOT NULL DEFAULT false,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payout_profiles_default_method_check" CHECK ("default_method" IN ('bank_file','paymongo','manual')),
  CONSTRAINT "payout_profiles_max_amount_check" CHECK ("max_amount_per_file" IS NULL OR "max_amount_per_file" > 0),
  CONSTRAINT "payout_profiles_max_rows_check" CHECK ("max_rows_per_file" IS NULL OR "max_rows_per_file" > 0),
  CONSTRAINT "payout_profiles_transaction_limit_check" CHECK ("transaction_limit" IS NULL OR "transaction_limit" > 0),
  CONSTRAINT "payout_profiles_daily_limit_check" CHECK ("daily_limit" IS NULL OR "daily_limit" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "payout_profiles_legal_entity_unique"
  ON "payout_profiles" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "payout_profiles_org_active_idx"
  ON "payout_profiles" ("organization_id","active");
