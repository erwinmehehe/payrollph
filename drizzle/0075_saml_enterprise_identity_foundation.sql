-- Enterprise SAML identity foundation.
-- SAML providers can be configured and metadata can be emitted, but authentication
-- remains fail-closed until signed XML assertion verification is implemented.

ALTER TABLE "identity_providers"
  ALTER COLUMN "issuer" DROP NOT NULL,
  ALTER COLUMN "client_id" DROP NOT NULL,
  ALTER COLUMN "client_secret_encrypted" DROP NOT NULL,
  ALTER COLUMN "authorization_endpoint" DROP NOT NULL,
  ALTER COLUMN "token_endpoint" DROP NOT NULL,
  ALTER COLUMN "jwks_uri" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "saml_entity_id" text,
  ADD COLUMN IF NOT EXISTS "saml_sso_url" text,
  ADD COLUMN IF NOT EXISTS "saml_x509_certificate" text,
  ADD COLUMN IF NOT EXISTS "saml_name_id_format" varchar(120),
  ADD COLUMN IF NOT EXISTS "saml_email_attribute" varchar(180),
  ADD COLUMN IF NOT EXISTS "saml_metadata_verified_at" timestamptz;

CREATE TABLE IF NOT EXISTS "saml_login_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_id" integer NOT NULL REFERENCES "identity_providers"("id") ON DELETE cascade,
  "request_id_hash" text NOT NULL UNIQUE,
  "relay_state_hash" text NOT NULL UNIQUE,
  "login_hint" varchar(180),
  "acs_url" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "saml_login_states_provider_expiry_idx"
  ON "saml_login_states" ("provider_id","expires_at");
