-- Enterprise access governance without lifecycle/LMS automation.
ALTER TABLE "user_organizations"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "local_password_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "auth_method" varchar(24) DEFAULT 'local' NOT NULL,
  ADD COLUMN IF NOT EXISTS "sso_connection_id" integer REFERENCES "sso_connections"("id") ON DELETE set null;

CREATE TABLE IF NOT EXISTS "organization_security_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE cascade,
  "session_idle_minutes" integer DEFAULT 1440 NOT NULL,
  "session_max_hours" integer DEFAULT 336 NOT NULL,
  "max_active_sessions" integer DEFAULT 10 NOT NULL,
  "require_local_mfa" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "organization_security_policies_org_idx"
  ON "organization_security_policies" ("organization_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_external_unique"
  ON "scim_identities" ("organization_id","external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scim_identities_org_user_unique"
  ON "scim_identities" ("organization_id","user_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "permission_sets_org_name_unique"
  ON "permission_sets" ("organization_id","name");

CREATE TABLE IF NOT EXISTS "user_permission_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_organization_id" integer NOT NULL REFERENCES "user_organizations"("id") ON DELETE cascade,
  "permission_set_id" integer NOT NULL REFERENCES "permission_sets"("id") ON DELETE cascade,
  "assigned_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_assignments_membership_unique"
  ON "user_permission_assignments" ("user_organization_id");
CREATE INDEX IF NOT EXISTS "user_permission_assignments_org_idx"
  ON "user_permission_assignments" ("organization_id");
