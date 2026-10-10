-- Governed future-only WFM roster batch approval; application flag OFF by default.
-- Additive schema only. DBA migration receipt, restore rehearsal and exact SHA approval required.
CREATE TABLE IF NOT EXISTS "workforce_roster_batches" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "work_date" date NOT NULL,
  "shift_definition_id" integer NOT NULL REFERENCES "shift_definitions"("id") ON DELETE RESTRICT,
  "employee_ids" jsonb NOT NULL,
  "evidence_sha256" varchar(64) NOT NULL,
  "request_sha256" varchar(64) NOT NULL,
  "idempotency_key" varchar(80) NOT NULL,
  "reason" varchar(240) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "requested_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requested_by_name" varchar(120) NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by_name" varchar(120),
  "decided_at" timestamptz,
  "decision_note" varchar(240),
  "override_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wfm_roster_batches_status_check" CHECK ("status" IN ('pending','approved','rejected','stale')),
  CONSTRAINT "wfm_roster_batches_employees_check" CHECK (
    jsonb_typeof("employee_ids") = 'array'
    AND jsonb_array_length("employee_ids") BETWEEN 1 AND 20
  ),
  CONSTRAINT "wfm_roster_batches_maker_checker_check" CHECK (
    "decided_by_user_id" IS NULL OR "decided_by_user_id" <> "requested_by_user_id"
  ),
  CONSTRAINT "wfm_roster_batches_decision_check" CHECK (
    ("status" = 'pending' AND "decided_at" IS NULL AND "decided_by_user_id" IS NULL)
    OR ("status" <> 'pending' AND "decided_at" IS NOT NULL AND "decided_by_user_id" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "wfm_roster_batches_idempotency_unique"
  ON "workforce_roster_batches"("organization_id","requested_by_user_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "wfm_roster_batches_review_idx"
  ON "workforce_roster_batches"("organization_id","status","work_date","id");
