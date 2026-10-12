-- ADDITIVE QA PROPOSAL, NOT A NUMBERED/APPROVED PRODUCTION MIGRATION.
-- These composite tenant keys prevent an employer row from linking another
-- employer's employee/case/document/expense policy, even when application code
-- is bypassed. A DBA must review cardinality and existing-row backfill before
-- assigning a release number.
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_employees_org_id_unique ON employees(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_documents_org_id_unique ON documents(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_separation_org_id_unique ON separation_records(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_hr_case_org_id_unique ON employee_hr_cases(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_expense_policy_org_id_unique ON expense_category_policies(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS a1a6_hcm_doc_compliance_org_id_unique ON hcm_employee_document_compliance(organization_id,id);
ALTER TABLE employee_hr_cases ADD CONSTRAINT a1a6_hr_case_worker_tenant_fk
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
ALTER TABLE employee_hr_case_messages ADD CONSTRAINT a1a6_hr_message_case_tenant_fk
  FOREIGN KEY (organization_id,case_id) REFERENCES employee_hr_cases(organization_id,id) ON DELETE CASCADE;
ALTER TABLE hcm_document_expiry_notices ADD CONSTRAINT a1a6_expiry_worker_tenant_fk
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
ALTER TABLE hcm_document_expiry_notices ADD CONSTRAINT a1a6_expiry_document_tenant_fk
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id) ON DELETE CASCADE;
ALTER TABLE hcm_document_expiry_notices ADD CONSTRAINT a1a6_expiry_compliance_tenant_fk
  FOREIGN KEY (organization_id,compliance_id) REFERENCES hcm_employee_document_compliance(organization_id,id) ON DELETE CASCADE;
ALTER TABLE separation_clearance_waivers ADD CONSTRAINT a1a6_clearance_worker_tenant_fk
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
ALTER TABLE separation_clearance_waivers ADD CONSTRAINT a1a6_clearance_separation_tenant_fk
  FOREIGN KEY (organization_id,separation_id) REFERENCES separation_records(organization_id,id) ON DELETE CASCADE;
ALTER TABLE expense_claims ADD CONSTRAINT a1a6_claim_category_policy_tenant_fk
  FOREIGN KEY (organization_id,category_policy_id) REFERENCES expense_category_policies(organization_id,id);
