-- HCM Core 3.5: employment decision evidence packets.
-- Review evidence is append-only while pending and sealed at approval.

ALTER TABLE "hcm_employment_term_decisions"
  ADD COLUMN IF NOT EXISTS "evidence_snapshot_sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "evidence_sealed_at" timestamptz;

CREATE TABLE IF NOT EXISTS "hcm_employment_decision_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "decision_id" integer NOT NULL REFERENCES "hcm_employment_term_decisions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "note_kind" varchar(32) NOT NULL
    CHECK ("note_kind" IN ('manager_review','hr_review','decision_rationale','other')),
  "content" text NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_employment_decision_notes_decision_idx"
  ON "hcm_employment_decision_notes" ("organization_id","decision_id","created_at");

CREATE TABLE IF NOT EXISTS "hcm_employment_decision_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "decision_id" integer NOT NULL REFERENCES "hcm_employment_term_decisions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE restrict,
  "evidence_kind" varchar(40) NOT NULL
    CHECK ("evidence_kind" IN ('probation_evaluation','performance_review','contract','manager_recommendation','other')),
  "label" varchar(180) NOT NULL,
  "attached_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "attached_by_name" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_employment_decision_document_unique"
  ON "hcm_employment_decision_documents" ("decision_id","document_id");

CREATE INDEX IF NOT EXISTS "hcm_employment_decision_documents_decision_idx"
  ON "hcm_employment_decision_documents" ("organization_id","decision_id","created_at");

CREATE TABLE IF NOT EXISTS "hcm_employment_decision_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "decision_id" integer NOT NULL REFERENCES "hcm_employment_term_decisions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "event_type" varchar(40) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_employment_decision_events_decision_idx"
  ON "hcm_employment_decision_events" ("organization_id","decision_id","created_at");

CREATE INDEX IF NOT EXISTS "hcm_employment_decision_events_employee_idx"
  ON "hcm_employment_decision_events" ("organization_id","employee_id","created_at");

-- Backfill a minimal immutable timeline for decisions that predate Core 3.5.
INSERT INTO "hcm_employment_decision_events" (
  "organization_id","decision_id","employee_id","event_type","actor_user_id","actor_name","metadata","created_at"
)
SELECT d."organization_id",d."id",d."employee_id",'requested',d."requested_by_user_id",d."requested_by",
  jsonb_build_object('backfilled', true, 'decisionKind', d."decision_kind", 'effectiveDate', d."effective_date"),
  d."created_at"
FROM "hcm_employment_term_decisions" d
WHERE NOT EXISTS (
  SELECT 1 FROM "hcm_employment_decision_events" e
  WHERE e."decision_id" = d."id" AND e."event_type" = 'requested'
);

INSERT INTO "hcm_employment_decision_events" (
  "organization_id","decision_id","employee_id","event_type","actor_user_id","actor_name","metadata","created_at"
)
SELECT d."organization_id",d."id",d."employee_id",'approved',d."approved_by_user_id",COALESCE(d."approved_by",'Unknown approver'),
  jsonb_build_object('backfilled', true),d."approved_at"
FROM "hcm_employment_term_decisions" d
WHERE d."approved_at" IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM "hcm_employment_decision_events" e
  WHERE e."decision_id" = d."id" AND e."event_type" = 'approved'
);

INSERT INTO "hcm_employment_decision_events" (
  "organization_id","decision_id","employee_id","event_type","actor_user_id","actor_name","metadata","created_at"
)
SELECT d."organization_id",d."id",d."employee_id",'applied',
  COALESCE(d."approved_by_user_id",d."requested_by_user_id"),
  COALESCE(d."approved_by",d."requested_by",'System'),
  jsonb_build_object('backfilled', true, 'successorTermId', d."successor_term_id", 'separationHandoffStatus', d."separation_handoff_status"),
  d."applied_at"
FROM "hcm_employment_term_decisions" d
WHERE d."applied_at" IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM "hcm_employment_decision_events" e
  WHERE e."decision_id" = d."id" AND e."event_type" = 'applied'
);

INSERT INTO "hcm_employment_decision_events" (
  "organization_id","decision_id","employee_id","event_type","actor_user_id","actor_name","metadata","created_at"
)
SELECT d."organization_id",d."id",d."employee_id",'cancelled',d."cancelled_by_user_id",COALESCE(d."cancelled_by",'Unknown actor'),
  jsonb_build_object('backfilled', true),d."cancelled_at"
FROM "hcm_employment_term_decisions" d
WHERE d."cancelled_at" IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM "hcm_employment_decision_events" e
  WHERE e."decision_id" = d."id" AND e."event_type" = 'cancelled'
);
