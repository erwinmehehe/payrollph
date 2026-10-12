-- 0115: forward-only recovery of missing payout_profiles objects.
-- Based on the CREATE TABLE/index portion of historical 0074, but this is a
-- NEW reviewed migration, NOT a claim that all 0074 statements ran in main.
-- Predecessors: organizations, legal_entities, bank_templates and users.
-- Bank-template metadata/constraints from 0074 need separate receipt review.
-- Default active=false and bank_file; NO payout account activation or money-out.
-- DRAFT / DO NOT APPLY ON NEON MAIN until source history and restore are approved.

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

-- Additional same-organization invariant. Independent foreign keys only prove
-- a legal entity exists; they do not prove it belongs to profile organization.
CREATE OR REPLACE FUNCTION validate_payout_profile_tenant_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM le.id FROM public.legal_entities le
    WHERE le.id = NEW.legal_entity_id
      AND le.organization_id = NEW.organization_id
    FOR SHARE OF le;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_PROFILE_TENANT_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payout_profile_tenant_guard
  BEFORE INSERT OR UPDATE OF organization_id, legal_entity_id
  ON public.payout_profiles FOR EACH ROW
  EXECUTE FUNCTION validate_payout_profile_tenant_scope();
