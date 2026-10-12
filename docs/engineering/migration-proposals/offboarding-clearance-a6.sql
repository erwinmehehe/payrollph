-- PROPOSAL ONLY. Allocate a canonical sequential migration number after #865
-- and review against the latest force-updated main before applying.
-- No production DDL or auto-bootstrap at request time.
CREATE TABLE IF NOT EXISTS "separation_clearance_waivers" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "separation_id" integer NOT NULL REFERENCES "separation_records" ("id") ON DELETE CASCADE,
  "employee_id" integer NOT NULL REFERENCES "employees" ("id") ON DELETE CASCADE,
  "department" varchar(16) NOT NULL
    CHECK ("department" IN ('it', 'admin', 'finance', 'hr')),
  "reason" varchar(500) NOT NULL,
  "evidence_reference" varchar(200) NOT NULL,
  "authorized_by_user_id" integer NOT NULL REFERENCES "users" ("id"),
  "authorized_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "revoked_by_user_id" integer REFERENCES "users" ("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "separation_clearance_waivers_active_unique"
  ON "separation_clearance_waivers" ("separation_id", "department")
  WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "separation_clearance_waivers_org_sep_idx"
  ON "separation_clearance_waivers" ("organization_id", "separation_id");
