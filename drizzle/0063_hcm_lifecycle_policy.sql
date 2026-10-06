-- HCM Core 3.7: organization lifecycle policy configuration and immutable change evidence.
-- Policy settings control readiness/reminder behavior only; they never mutate employment state automatically.

CREATE TABLE IF NOT EXISTS "hcm_lifecycle_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "action_window_days" integer NOT NULL DEFAULT 30
    CHECK ("action_window_days" BETWEEN 7 AND 90),
  "reminder_days" jsonb NOT NULL DEFAULT '[30,14,7,1,0]'::jsonb
    CHECK (jsonb_typeof("reminder_days") = 'array'),
  "overdue_escalation_days" jsonb NOT NULL DEFAULT '[1,5]'::jsonb
    CHECK (jsonb_typeof("overdue_escalation_days") = 'array'),
  "require_manager_review_for_probation" boolean NOT NULL DEFAULT false,
  "require_decision_rationale_note" boolean NOT NULL DEFAULT false,
  "require_non_renewal_attachment" boolean NOT NULL DEFAULT false,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_name" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "hcm_lifecycle_policies_org_unique"
  ON "hcm_lifecycle_policies" ("organization_id");

CREATE TABLE IF NOT EXISTS "hcm_lifecycle_policy_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "policy_id" integer NOT NULL REFERENCES "hcm_lifecycle_policies"("id") ON DELETE restrict,
  "event_type" varchar(32) NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL,
  "from_version" integer,
  "to_version" integer NOT NULL,
  "before_snapshot" jsonb,
  "after_snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_policy_events_org_idx"
  ON "hcm_lifecycle_policy_events" ("organization_id","created_at");

CREATE INDEX IF NOT EXISTS "hcm_lifecycle_policy_events_policy_idx"
  ON "hcm_lifecycle_policy_events" ("policy_id","created_at");
