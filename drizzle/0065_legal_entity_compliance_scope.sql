-- Scope government filing/remittance/reconciliation evidence to one legal employer.
-- Legacy rows are conservatively attached to the organization's PRIMARY legal entity.
-- Filing records tied to a payroll run use that run's legal employer first.

ALTER TABLE "government_filing_validations"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "bir_withholding_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "statutory_remittance_members"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "statutory_remittance_month_closures"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "statutory_contribution_issue_cases"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "government_loan_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;
ALTER TABLE "government_loan_remittance_members"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE RESTRICT;

UPDATE "government_filing_validations" gfv
SET "legal_entity_id" = COALESCE(
  (SELECT pr."legal_entity_id" FROM "payroll_runs" pr WHERE pr."id" = gfv."payroll_run_id"),
  (SELECT le."id" FROM "legal_entities" le
    WHERE le."organization_id" = gfv."organization_id" AND le."primary_entity" = true
    ORDER BY le."id" LIMIT 1)
)
WHERE gfv."legal_entity_id" IS NULL;

UPDATE "bir_withholding_remittance_batches" b
SET "legal_entity_id" = le."id"
FROM "legal_entities" le
WHERE b."legal_entity_id" IS NULL
  AND le."organization_id" = b."organization_id"
  AND le."primary_entity" = true;

UPDATE "statutory_remittance_batches" b
SET "legal_entity_id" = le."id"
FROM "legal_entities" le
WHERE b."legal_entity_id" IS NULL
  AND le."organization_id" = b."organization_id"
  AND le."primary_entity" = true;

UPDATE "statutory_remittance_members" m
SET "legal_entity_id" = b."legal_entity_id"
FROM "statutory_remittance_batches" b
WHERE m."legal_entity_id" IS NULL
  AND m."batch_id" = b."id";

UPDATE "statutory_remittance_month_closures" c
SET "legal_entity_id" = le."id"
FROM "legal_entities" le
WHERE c."legal_entity_id" IS NULL
  AND le."organization_id" = c."organization_id"
  AND le."primary_entity" = true;

UPDATE "statutory_contribution_issue_cases" c
SET "legal_entity_id" = COALESCE(
  (SELECT b."legal_entity_id" FROM "statutory_remittance_batches" b WHERE b."id" = c."batch_id"),
  (SELECT e."legal_entity_id" FROM "employees" e WHERE e."id" = c."employee_id"),
  (SELECT le."id" FROM "legal_entities" le
    WHERE le."organization_id" = c."organization_id" AND le."primary_entity" = true
    ORDER BY le."id" LIMIT 1)
)
WHERE c."legal_entity_id" IS NULL;

UPDATE "government_loan_remittance_batches" b
SET "legal_entity_id" = le."id"
FROM "legal_entities" le
WHERE b."legal_entity_id" IS NULL
  AND le."organization_id" = b."organization_id"
  AND le."primary_entity" = true;

UPDATE "government_loan_remittance_members" m
SET "legal_entity_id" = b."legal_entity_id"
FROM "government_loan_remittance_batches" b
WHERE m."legal_entity_id" IS NULL
  AND m."batch_id" = b."id";

DO $scope$
BEGIN
  IF EXISTS (SELECT 1 FROM "government_filing_validations" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "bir_withholding_remittance_batches" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "statutory_remittance_batches" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "statutory_remittance_members" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "statutory_remittance_month_closures" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "statutory_contribution_issue_cases" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "government_loan_remittance_batches" WHERE "legal_entity_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "government_loan_remittance_members" WHERE "legal_entity_id" IS NULL)
  THEN
    RAISE EXCEPTION 'Legal-employer compliance backfill incomplete; resolve organization/legal-entity ownership before continuing.';
  END IF;
END
$scope$;

ALTER TABLE "government_filing_validations" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "bir_withholding_remittance_batches" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "statutory_remittance_batches" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "statutory_remittance_members" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "statutory_remittance_month_closures" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "statutory_contribution_issue_cases" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "government_loan_remittance_batches" ALTER COLUMN "legal_entity_id" SET NOT NULL;
ALTER TABLE "government_loan_remittance_members" ALTER COLUMN "legal_entity_id" SET NOT NULL;

DROP INDEX IF EXISTS "government_filing_file_unique";
CREATE UNIQUE INDEX "government_filing_file_unique"
  ON "government_filing_validations" ("organization_id", "legal_entity_id", "agency", "form", "file_sha256");
DROP INDEX IF EXISTS "government_filing_status_idx";
CREATE INDEX "government_filing_status_idx"
  ON "government_filing_validations" ("organization_id", "legal_entity_id", "agency", "form", "status");

DROP INDEX IF EXISTS "bir_withholding_remittance_month_unique";
CREATE UNIQUE INDEX "bir_withholding_remittance_month_unique"
  ON "bir_withholding_remittance_batches" ("organization_id", "legal_entity_id", "applicable_month");
DROP INDEX IF EXISTS "bir_withholding_remittance_due_idx";
CREATE INDEX "bir_withholding_remittance_due_idx"
  ON "bir_withholding_remittance_batches" ("organization_id", "legal_entity_id", "status", "payment_due_date");
DROP INDEX IF EXISTS "bir_withholding_remittance_filing_idx";
CREATE INDEX "bir_withholding_remittance_filing_idx"
  ON "bir_withholding_remittance_batches" ("organization_id", "legal_entity_id", "filing_validation_id");

DROP INDEX IF EXISTS "statutory_remittance_batch_unique";
CREATE UNIQUE INDEX "statutory_remittance_batch_unique"
  ON "statutory_remittance_batches" ("organization_id", "legal_entity_id", "agency", "applicable_month");
DROP INDEX IF EXISTS "statutory_remittance_due_idx";
CREATE INDEX "statutory_remittance_due_idx"
  ON "statutory_remittance_batches" ("organization_id", "legal_entity_id", "status", "due_date");
DROP INDEX IF EXISTS "statutory_remittance_member_status_idx";
CREATE INDEX "statutory_remittance_member_status_idx"
  ON "statutory_remittance_members" ("organization_id", "legal_entity_id", "posting_status");

DROP INDEX IF EXISTS "statutory_remittance_month_closure_snapshot_unique";
CREATE UNIQUE INDEX "statutory_remittance_month_closure_snapshot_unique"
  ON "statutory_remittance_month_closures" ("organization_id", "legal_entity_id", "applicable_month", "snapshot_hash");
DROP INDEX IF EXISTS "statutory_remittance_month_closure_status_idx";
CREATE INDEX "statutory_remittance_month_closure_status_idx"
  ON "statutory_remittance_month_closures" ("organization_id", "legal_entity_id", "status");

DROP INDEX IF EXISTS "statutory_contribution_issue_org_status_idx";
CREATE INDEX "statutory_contribution_issue_org_status_idx"
  ON "statutory_contribution_issue_cases" ("organization_id", "legal_entity_id", "status", "created_at");
DROP INDEX IF EXISTS "statutory_contribution_issue_employee_idx";
CREATE INDEX "statutory_contribution_issue_employee_idx"
  ON "statutory_contribution_issue_cases" ("organization_id", "legal_entity_id", "employee_id", "created_at");

DROP INDEX IF EXISTS "government_loan_remittance_batch_unique";
CREATE UNIQUE INDEX "government_loan_remittance_batch_unique"
  ON "government_loan_remittance_batches" ("organization_id", "legal_entity_id", "agency", "applicable_month");
DROP INDEX IF EXISTS "government_loan_remittance_due_idx";
CREATE INDEX "government_loan_remittance_due_idx"
  ON "government_loan_remittance_batches" ("organization_id", "legal_entity_id", "status", "due_date");
DROP INDEX IF EXISTS "government_loan_remittance_member_status_idx";
CREATE INDEX "government_loan_remittance_member_status_idx"
  ON "government_loan_remittance_members" ("organization_id", "legal_entity_id", "posting_status");
