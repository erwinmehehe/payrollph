-- A-3 review-only / NOT AN ALLOCATED RELEASE MIGRATION.
-- DBA must verify authentic prior 0115-012x and A-5 history, run catalog/read-only
-- orphan checks, assign one collision-free numbered migration, and rehearse
-- on protected sanitized clone before any production DDL.
--
-- Prevent an HR case from pointing to a worker or COE document owned by a
-- different organization, or a message from pointing to a foreign case.
-- No historical HR/employee ownership is inferred or silently reassigned.
--
-- Preflight (read-only): queries MUST return zero rows before validation.
-- SELECT c.id FROM employee_hr_cases c JOIN employees e ON e.id=c.employee_id
--   WHERE c.organization_id<>e.organization_id;
-- SELECT m.id FROM employee_hr_case_messages m JOIN employee_hr_cases c ON c.id=m.case_id
--   WHERE m.organization_id<>c.organization_id;
-- SELECT c.id FROM employee_hr_cases c JOIN documents d ON d.id=c.coe_document_id
--   WHERE c.coe_document_id IS NOT NULL AND c.organization_id<>d.organization_id;

-- Required parent keys are schema-first compatible. If a historical
-- employees(org,id) key is missing, stop and reconcile #910 first.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_hr_cases_org_id_unique"
  ON "employee_hr_cases"("organization_id","id");
CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_id_hr_cases_unique"
  ON "documents"("organization_id","id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_hr_cases_employee_tenant_fk'
      AND conrelid='employee_hr_cases'::regclass) THEN
    ALTER TABLE "employee_hr_cases" ADD CONSTRAINT "employee_hr_cases_employee_tenant_fk"
      FOREIGN KEY ("organization_id","employee_id")
      REFERENCES "employees"("organization_id","id") ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_hr_cases_coe_document_tenant_fk'
      AND conrelid='employee_hr_cases'::regclass) THEN
    ALTER TABLE "employee_hr_cases" ADD CONSTRAINT "employee_hr_cases_coe_document_tenant_fk"
      FOREIGN KEY ("organization_id","coe_document_id")
      REFERENCES "documents"("organization_id","id") NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_hr_case_messages_case_tenant_fk'
      AND conrelid='employee_hr_case_messages'::regclass) THEN
    ALTER TABLE "employee_hr_case_messages" ADD CONSTRAINT "employee_hr_case_messages_case_tenant_fk"
      FOREIGN KEY ("organization_id","case_id")
      REFERENCES "employee_hr_cases"("organization_id","id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- NEVER claim FK acceptance if existing inconsistent rows remain:
-- VALIDATE must fail rather than approving corrupted historic ownership.
ALTER TABLE "employee_hr_cases" VALIDATE CONSTRAINT "employee_hr_cases_employee_tenant_fk";
ALTER TABLE "employee_hr_cases" VALIDATE CONSTRAINT "employee_hr_cases_coe_document_tenant_fk";
ALTER TABLE "employee_hr_case_messages" VALIDATE CONSTRAINT "employee_hr_case_messages_case_tenant_fk";
