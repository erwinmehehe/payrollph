ALTER TABLE "employee_labor_allocations"
  ADD COLUMN IF NOT EXISTS "allocation_hours" numeric(10,3);

ALTER TABLE "employee_labor_allocations"
  DROP CONSTRAINT IF EXISTS "employee_labor_allocations_basis_check";

ALTER TABLE "employee_labor_allocations"
  ADD CONSTRAINT "employee_labor_allocations_basis_check"
  CHECK ("allocation_basis" IN ('percentage', 'hours'));

ALTER TABLE "employee_labor_allocations"
  DROP CONSTRAINT IF EXISTS "employee_labor_allocations_hours_check";

ALTER TABLE "employee_labor_allocations"
  ADD CONSTRAINT "employee_labor_allocations_hours_check"
  CHECK (
    ("allocation_basis" = 'percentage' AND "allocation_hours" IS NULL)
    OR ("allocation_basis" = 'hours' AND "allocation_hours" > 0)
  );

CREATE TABLE IF NOT EXISTS "labor_gl_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE cascade,
  "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE cascade,
  "account_key" varchar(64) NOT NULL,
  "account_code" varchar(40),
  "account_name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "labor_gl_mappings_scope_unique"
  ON "labor_gl_mappings" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    COALESCE("cost_center_id", 0),
    "account_key"
  );

CREATE INDEX IF NOT EXISTS "labor_gl_mappings_org_active_idx"
  ON "labor_gl_mappings" ("organization_id", "active");
