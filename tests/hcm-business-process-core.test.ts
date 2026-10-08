import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("enterprise HCM business process persistence is migrated and mirrored", () => {
  const migration = read("drizzle/0092_hcm_business_process_core.sql");
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  const compatibility = read("src/lib/core-schema-compat.ts");
  for (const source of [migration, schema, baseline, compatibility]) {
    assert.ok(source.includes("hcm_business_process_definitions"));
    assert.ok(source.includes("hcm_business_process_instances"));
    assert.ok(source.includes("hcm_business_process_instance_steps"));
  }
  assert.ok(migration.includes("hcm_bp_instances_source_unique"));
  assert.ok(schema.includes("hcmBusinessProcessDefinitions"));
});

test("Change Job is governed by the HCM business process engine", () => {
  const engine = read("src/lib/hcm-business-process.ts");
  const changeRoute = read("src/app/api/hcm/effective-changes/route.ts");
  const approvalRoute = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(engine.includes("supervisoryOrgPath"));
  assert.ok(engine.includes("chooseHcmBusinessProcessDefinition"));
  assert.ok(engine.includes("definitionSnapshot"));
  assert.ok(engine.includes("cancelHcmBusinessProcessForSourceTx"));
  assert.ok(changeRoute.includes("startHcmBusinessProcessTx(tx"));
  assert.ok(changeRoute.includes('sourceType: "worker_effective_change"'));
  assert.ok(changeRoute.includes("This HCM change is governed by a business process."));
  assert.ok(approvalRoute.includes("advanceHcmBusinessProcessAfterApprovalTx(tx"));
  assert.ok(approvalRoute.includes("finalizeHcmBusinessProcessSource"));
  assert.ok(approvalRoute.includes("hcmBusinessProcessApproval.initiatedByUserId === sessionUser.id"));
});

test("HCM Inbox and process studio expose governed enterprise workflows", () => {
  const inboxApi = read("src/app/api/hcm/business-processes/inbox/route.ts");
  const definitionsApi = read("src/app/api/hcm/business-processes/definitions/route.ts");
  const inboxUi = read("src/components/hcm-business-process-inbox.tsx");
  const adminUi = read("src/components/hcm-business-process-admin.tsx");
  assert.ok(inboxApi.includes("canDecide"));
  assert.ok(inboxApi.includes("completeHcmBusinessProcessWorkItemTx"));
  assert.ok(definitionsApi.includes("requireSensitiveActionMfa"));
  assert.ok(definitionsApi.includes('eq(orgUnits.type, "supervisory")'));
  assert.ok(inboxUi.includes("My requests"));
  assert.ok(inboxUi.includes("Process history"));
  assert.ok(adminUi.includes("Company default"));
  assert.ok(adminUi.includes("Save new version"));
});

test("HCM approvals and inbox remain org-unit scoped without weakening payroll protections", () => {
  const approvalRoute = read("src/app/api/approvals/[id]/route.ts");
  const inboxRoute = read("src/app/api/hcm/business-processes/inbox/route.ts");
  assert.ok(approvalRoute.includes("verifyPayrollApprovalSnapshot"));
  assert.ok(approvalRoute.includes("authorizedDynamicGroupMember"));
  assert.ok(approvalRoute.includes("assertOrganizationUnitAccess("));
  assert.ok(approvalRoute.includes("hcmBusinessProcessApproval.employeeId"));
  assert.ok(inboxRoute.includes("row.employeeOrgUnitId !== access.orgUnitId"));
  assert.ok(inboxRoute.includes("worker.orgUnitId !== access.orgUnitId"));
});
