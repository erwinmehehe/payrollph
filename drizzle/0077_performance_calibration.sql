-- Performance calibration foundation.
-- Calibration is an explicit People-governed step between completed manager reviews
-- and performance-cycle closure. It never triggers compensation changes.

ALTER TABLE "performance_cycles"
  ADD COLUMN IF NOT EXISTS "require_calibration" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "performance_calibration_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "performance_cycles"("id") ON DELETE cascade,
  "name" varchar(180) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" varchar(120) NOT NULL,
  "finalized_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "finalized_by_name" varchar(120),
  "finalized_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_calibration_sessions_status_check"
    CHECK ("status" IN ('open','finalized'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_calibration_sessions_cycle_unique"
  ON "performance_calibration_sessions" ("cycle_id");
CREATE INDEX IF NOT EXISTS "performance_calibration_sessions_org_status_idx"
  ON "performance_calibration_sessions" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "performance_calibration_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "session_id" integer NOT NULL REFERENCES "performance_calibration_sessions"("id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "performance_reviews"("id") ON DELETE cascade,
  "original_score" numeric(4,2) NOT NULL,
  "calibrated_score" numeric(4,2),
  "rationale" text,
  "calibrated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "calibrated_by_name" varchar(120),
  "calibrated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "performance_calibration_entries_original_score_check"
    CHECK ("original_score" >= 1 AND "original_score" <= 5),
  CONSTRAINT "performance_calibration_entries_calibrated_score_check"
    CHECK ("calibrated_score" IS NULL OR ("calibrated_score" >= 1 AND "calibrated_score" <= 5))
);
CREATE UNIQUE INDEX IF NOT EXISTS "performance_calibration_entries_session_review_unique"
  ON "performance_calibration_entries" ("session_id","review_id");
CREATE INDEX IF NOT EXISTS "performance_calibration_entries_org_session_idx"
  ON "performance_calibration_entries" ("organization_id","session_id");
