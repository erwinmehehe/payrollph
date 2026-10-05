CREATE TABLE IF NOT EXISTS "sso_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_name" varchar(80) NOT NULL,
  "email_domain" varchar(190) NOT NULL,
  "issuer" text NOT NULL,
  "client_id" varchar(240) NOT NULL,
  "client_secret_ciphertext" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_by" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sso_connections_org_unique" ON "sso_connections" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sso_connections_domain_unique" ON "sso_connections" ("email_domain");

CREATE TABLE IF NOT EXISTS "sso_login_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "connection_id" integer NOT NULL REFERENCES "sso_connections"("id") ON DELETE CASCADE,
  "state_hash" varchar(64) NOT NULL,
  "pkce_verifier_ciphertext" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sso_login_states_hash_unique" ON "sso_login_states" ("state_hash");
CREATE INDEX IF NOT EXISTS "sso_login_states_expiry_idx" ON "sso_login_states" ("expires_at");
