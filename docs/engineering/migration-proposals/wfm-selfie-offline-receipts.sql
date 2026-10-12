-- WFM optional selfie/photo evidence and offline punch receipts.
-- Apply only under the migration runbook before enabling either release flag.
CREATE TABLE IF NOT EXISTS "workforce_punch_photo_policies" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "worksite_id" integer NOT NULL REFERENCES "worksites"("id") ON DELETE CASCADE,
  "capture_enabled" boolean NOT NULL DEFAULT false,
  "retention_days" integer NOT NULL DEFAULT 90,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wfm_photo_retention_bounds" CHECK ("retention_days" BETWEEN 1 AND 365)
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_photo_policy_org_site_unique"
  ON "workforce_punch_photo_policies" ("organization_id","worksite_id");

CREATE TABLE IF NOT EXISTS "workforce_punch_photo_consents" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "consented" boolean NOT NULL,
  "purpose_version" varchar(32) NOT NULL DEFAULT 'wfm-photo-v1',
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_photo_consent_org_employee_unique"
  ON "workforce_punch_photo_consents" ("organization_id", "employee_id");

CREATE TABLE IF NOT EXISTS "workforce_punch_photo_evidence" (
 "id" varchar(36) PRIMARY KEY,
 "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
 "worksite_id" integer REFERENCES "worksites"("id") ON DELETE SET NULL,
 "punch_id" integer REFERENCES "time_punches"("id") ON DELETE SET NULL,
 "action_type" varchar(16) NOT NULL,
 "mime_type" varchar(40) NOT NULL,
 "sealed_photo" text NOT NULL,
 "content_sha256" varchar(64) NOT NULL,
 "byte_size" integer NOT NULL,
 "expires_at" timestamptz NOT NULL,
 "legal_hold" boolean NOT NULL DEFAULT false,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "workforce_photo_evidence_action_check" CHECK ("action_type" IN ('clock_in','clock_out'))
);
CREATE INDEX IF NOT EXISTS "workforce_photo_evidence_employee_idx"
 ON "workforce_punch_photo_evidence" ("organization_id","employee_id","created_at");
CREATE INDEX IF NOT EXISTS "workforce_photo_evidence_purge_idx"
 ON "workforce_punch_photo_evidence" ("expires_at","legal_hold");

CREATE TABLE IF NOT EXISTS "workforce_offline_punch_receipts" (
 "id" varchar(36) PRIMARY KEY,
 "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
 "worksite_id" integer REFERENCES "worksites"("id") ON DELETE SET NULL,
 "device_token_hash" varchar(64) NOT NULL,
 "action_type" varchar(16) NOT NULL,
 "device_timestamp" timestamptz NOT NULL,
 "server_received_at" timestamptz NOT NULL DEFAULT now(),
 "review_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
 "status" varchar(24) NOT NULL DEFAULT 'pending_review',
 "reviewer_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
 "review_reason" varchar(400),
 "reviewed_at" timestamptz,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "offline_punch_action_check" CHECK ("action_type" IN ('clock_in','break_start','break_end','clock_out')),
 CONSTRAINT "offline_punch_status_check" CHECK ("status" IN ('pending_review','reviewed','rejected'))
);
CREATE INDEX IF NOT EXISTS "workforce_offline_org_status_idx"
 ON "workforce_offline_punch_receipts" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "workforce_offline_device_idx"
 ON "workforce_offline_punch_receipts" ("organization_id","device_token_hash");
CREATE INDEX IF NOT EXISTS "workforce_offline_employee_idx"
 ON "workforce_offline_punch_receipts" ("organization_id","employee_id");
