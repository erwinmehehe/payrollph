-- Provider-specific Automation Studio connectors: Slack v1.

CREATE TABLE IF NOT EXISTS "integration_connectors" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider" varchar(32) NOT NULL,
  "name" varchar(120) NOT NULL,
  "credential_ciphertext" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "verified_at" timestamptz,
  "verified_identity" jsonb,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_connectors_provider_check" CHECK ("provider" IN ('slack'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_connectors_org_name_unique"
  ON "integration_connectors" ("organization_id","name");
CREATE INDEX IF NOT EXISTS "integration_connectors_org_provider_active_idx"
  ON "integration_connectors" ("organization_id","provider","active");

CREATE TABLE IF NOT EXISTS "integration_connector_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "connector_id" integer NOT NULL REFERENCES "integration_connectors"("id") ON DELETE restrict,
  "automation_execution_id" integer REFERENCES "automation_executions"("id") ON DELETE set null,
  "action_index" integer,
  "event_key" varchar(240),
  "destination" varchar(120) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','succeeded','failed')),
  "provider_message_id" varchar(160),
  "provider_channel_id" varchar(120),
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_connector_delivery_automation_unique"
  ON "integration_connector_deliveries" ("connector_id","automation_execution_id","action_index")
  WHERE "automation_execution_id" IS NOT NULL AND "action_index" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "integration_connector_deliveries_org_status_idx"
  ON "integration_connector_deliveries" ("organization_id","status","created_at");
