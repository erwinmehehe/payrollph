ALTER TABLE "government_filing_validations"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "bir_withholding_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "statutory_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "government_loan_remittance_batches"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "statutory_contribution_issue_cases"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "payroll_month_closures"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;
ALTER TABLE "statutory_remittance_month_closures"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

UPDATE "government_filing_validations" f
SET "legal_entity_id" = r."legal_entity_id"
FROM "payroll_runs" r
WHERE f."legal_entity_id" IS NULL
  AND f."payroll_run_id" = r."id"
  AND r."legal_entity_id" IS NOT NULL;

UPDATE "statutory_remittance_batches" b
SET "legal_entity_id" = scoped."legal_entity_id"
FROM (
  SELECT m."batch_id", MIN(e."legal_entity_id") AS "legal_entity_id"
  FROM "statutory_remittance_members" m
  JOIN "employees" e ON e."id" = m."employee_id"
  WHERE e."legal_entity_id" IS NOT NULL
  GROUP BY m."batch_id"
  HAVING COUNT(DISTINCT e."legal_entity_id") = 1
) scoped
WHERE b."id" = scoped."batch_id"
  AND b."legal_entity_id" IS NULL;

UPDATE "government_loan_remittance_batches" b
SET "legal_entity_id" = scoped."legal_entity_id"
FROM (
  SELECT m."batch_id", MIN(e."legal_entity_id") AS "legal_entity_id"
  FROM "government_loan_remittance_members" m
  JOIN "employees" e ON e."id" = m."employee_id"
  WHERE e."legal_entity_id" IS NOT NULL
  GROUP BY m."batch_id"
  HAVING COUNT(DISTINCT e."legal_entity_id") = 1
) scoped
WHERE b."id" = scoped."batch_id"
  AND b."legal_entity_id" IS NULL;

UPDATE "statutory_contribution_issue_cases" c
SET "legal_entity_id" = e."legal_entity_id"
FROM "employees" e
WHERE c."employee_id" = e."id"
  AND c."legal_entity_id" IS NULL
  AND e."legal_entity_id" IS NOT NULL;

DROP INDEX IF EXISTS "government_filing_file_unique";
CREATE UNIQUE INDEX "government_filing_file_unique"
  ON "government_filing_validations" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "agency",
    "form",
    "file_sha256"
  );

DROP INDEX IF EXISTS "bir_withholding_remittance_month_unique";
CREATE UNIQUE INDEX "bir_withholding_remittance_month_unique"
  ON "bir_withholding_remittance_batches" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "applicable_month"
  );

DROP INDEX IF EXISTS "statutory_remittance_batch_unique";
CREATE UNIQUE INDEX "statutory_remittance_batch_unique"
  ON "statutory_remittance_batches" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "agency",
    "applicable_month"
  );

DROP INDEX IF EXISTS "government_loan_remittance_batch_unique";
CREATE UNIQUE INDEX "government_loan_remittance_batch_unique"
  ON "government_loan_remittance_batches" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "agency",
    "applicable_month"
  );

DROP INDEX IF EXISTS "payroll_month_closure_snapshot_unique";
CREATE UNIQUE INDEX "payroll_month_closure_snapshot_unique"
  ON "payroll_month_closures" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "applicable_month",
    "snapshot_hash"
  );

DROP INDEX IF EXISTS "statutory_remittance_month_closure_snapshot_unique";
CREATE UNIQUE INDEX "statutory_remittance_month_closure_snapshot_unique"
  ON "statutory_remittance_month_closures" (
    "organization_id",
    COALESCE("legal_entity_id", 0),
    "applicable_month",
    "snapshot_hash"
  );

CREATE INDEX IF NOT EXISTS "government_filing_entity_month_idx"
  ON "government_filing_validations" ("organization_id", "legal_entity_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "statutory_remittance_entity_month_idx"
  ON "statutory_remittance_batches" ("organization_id", "legal_entity_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "bir_withholding_entity_month_idx"
  ON "bir_withholding_remittance_batches" ("organization_id", "legal_entity_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "government_loan_entity_month_idx"
  ON "government_loan_remittance_batches" ("organization_id", "legal_entity_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "payroll_month_closure_entity_idx"
  ON "payroll_month_closures" ("organization_id", "legal_entity_id", "applicable_month");
CREATE INDEX IF NOT EXISTS "statutory_month_closure_entity_idx"
  ON "statutory_remittance_month_closures" ("organization_id", "legal_entity_id", "applicable_month");
