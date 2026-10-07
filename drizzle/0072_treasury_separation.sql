-- Enterprise treasury separation: explicit stable-user payout operators and release-vs-disbursement separation.

CREATE TABLE IF NOT EXISTS "treasury_control_policies" (
  "organization_id" integer PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "enabled" boolean NOT NULL DEFAULT false,
  "require_release_submitter_separation" boolean NOT NULL DEFAULT true,
  "enabled_at" timestamptz,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "treasury_operator_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "treasury_operator_assignments_org_user_unique"
  ON "treasury_operator_assignments" ("organization_id","user_id");
CREATE INDEX IF NOT EXISTS "treasury_operator_assignments_org_active_idx"
  ON "treasury_operator_assignments" ("organization_id","active");
