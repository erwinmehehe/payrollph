ALTER TABLE "user_organizations"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "local_password_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "auth_method" varchar(24) DEFAULT 'local' NOT NULL,
  ADD COLUMN IF NOT EXISTS "identity_provider_id" integer;

CREATE TABLE IF NOT EXISTS "organization_security_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "session_idle_minutes" integer DEFAULT 1440 NOT NULL,
  "session_max_hours" integer DEFAULT 336 NOT NULL,
  "max_active_sessions" integer DEFAULT 10 NOT NULL,
  "require_mfa" boolean DEFAULT false NOT NULL,
  "sso_mode" varchar(24) DEFAULT 'optional' NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "organization_security_policies_org_idx" ON "organization_security_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "identity_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "protocol" varchar(24) DEFAULT 'oidc' NOT NULL,
  "issuer" text NOT NULL,
  "client_id" varchar(240) NOT NULL,
  "client_secret_encrypted" text NOT NULL,
  "authorization_endpoint" text NOT NULL,
  "token_endpoint" text NOT NULL,
  "jwks_uri" text NOT NULL,
  "scopes" varchar(240) DEFAULT 'openid email profile' NOT NULL,
  "email_claim" varchar(80) DEFAULT 'email' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "discovery_verified_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_providers_org_name_unique" ON "identity_providers" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "identity_providers_org_enabled_idx" ON "identity_providers" ("organization_id","enabled");

CREATE TABLE IF NOT EXISTS "identity_domains" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "domain" varchar(180) NOT NULL,
  "verification_token_hash" text NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_domains_domain_unique" ON "identity_domains" ("domain");
CREATE INDEX IF NOT EXISTS "identity_domains_org_provider_idx" ON "identity_domains" ("organization_id","provider_id");

CREATE TABLE IF NOT EXISTS "external_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "subject" varchar(240) NOT NULL,
  "email" varchar(180) NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_subject_unique" ON "external_identities" ("provider_id","subject");
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_user_unique" ON "external_identities" ("provider_id","user_id");

CREATE TABLE IF NOT EXISTS "oidc_login_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "state_hash" text NOT NULL UNIQUE,
  "nonce" varchar(180) NOT NULL,
  "code_verifier" text NOT NULL,
  "login_hint" varchar(180),
  "redirect_uri" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "oidc_login_states_provider_expiry_idx" ON "oidc_login_states" ("provider_id","expires_at");

CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "prefix" varchar(20) NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "scim_tokens_org_idx" ON "scim_tokens" ("organization_id");

CREATE TABLE IF NOT EXISTS "scim_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "external_id" varchar(240) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_external_unique" ON "scim_identities" ("organization_id","external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_user_unique" ON "scim_identities" ("organization_id","user_id");

CREATE TABLE IF NOT EXISTS "permission_sets" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "description" text,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "permission_sets_org_name_unique" ON "permission_sets" ("organization_id","name");

CREATE TABLE IF NOT EXISTS "user_permission_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_organization_id" integer NOT NULL REFERENCES "user_organizations"("id") ON DELETE cascade,
  "permission_set_id" integer NOT NULL REFERENCES "permission_sets"("id") ON DELETE cascade,
  "assigned_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_assignments_membership_unique" ON "user_permission_assignments" ("user_organization_id");
CREATE INDEX IF NOT EXISTS "user_permission_assignments_org_idx" ON "user_permission_assignments" ("organization_id");

CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "trigger" varchar(64) NOT NULL,
  "conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_org_name_unique" ON "automation_rules" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "automation_rules_org_trigger_idx" ON "automation_rules" ("organization_id","trigger");

CREATE TABLE IF NOT EXISTS "automation_executions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "rule_id" integer NOT NULL REFERENCES "automation_rules"("id") ON DELETE cascade,
  "employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "trigger" varchar(64) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "status" varchar(24) DEFAULT 'completed' NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_executions_rule_event_unique" ON "automation_executions" ("rule_id","event_key");
CREATE INDEX IF NOT EXISTS "automation_executions_org_created_idx" ON "automation_executions" ("organization_id","created_at");
