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


-- Forward-only DB defence in depth: independent simple foreign keys do not
-- prove that the waiver, separation and employee belong to ONE employer.
-- This function is a SOURCE PROPOSAL, not a production-approved DDL change.
CREATE OR REPLACE FUNCTION a6_validate_clearance_waiver_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.separation_id IS DISTINCT FROM OLD.separation_id OR
    NEW.employee_id IS DISTINCT FROM OLD.employee_id OR
    NEW.department IS DISTINCT FROM OLD.department OR
    NEW.reason IS DISTINCT FROM OLD.reason OR
    NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference OR
    NEW.authorized_by_user_id IS DISTINCT FROM OLD.authorized_by_user_id OR
    NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
  ) THEN
    RAISE EXCEPTION 'A6_WAIVER_HISTORY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL AND
    (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR
     NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id) THEN
    RAISE EXCEPTION 'A6_WAIVER_REVOCATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revoked_at IS NULL AND
    NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id THEN
    RAISE EXCEPTION 'A6_WAIVER_REVOCATION_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  PERFORM s.id
  FROM separation_records s
  JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
  WHERE s.id = NEW.separation_id
    AND s.organization_id = NEW.organization_id
    AND s.employee_id = NEW.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A6_WAIVER_TENANT_OR_EMPLOYEE_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER a6_clearance_waiver_scope_guard
  BEFORE INSERT OR UPDATE ON separation_clearance_waivers
  FOR EACH ROW EXECUTE FUNCTION a6_validate_clearance_waiver_scope();
