import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const schema = read("src/db/schema.ts");
const migration = read("drizzle/0048_hcm_documents_policy_center.sql");
const adminApi = read("src/app/api/hcm/documents/route.ts");
const selfApi = read("src/app/api/self/documents/route.ts");
const uploadApi = read("src/app/api/documents/route.ts");
const viewApi = read("src/app/api/documents/[id]/route.ts");
const hcm = read("src/lib/hcm-documents.ts");
const scheduler = read("src/lib/scheduler.ts");
const automation = read("src/lib/automation.ts");
const adminPanel = read("src/components/hcm-documents-panel.tsx");
const employeePanel = read("src/components/employee-documents-panel.tsx");
const employeePortal = read("src/components/self-service-portal.tsx");
const people = read("src/components/workspace/people.tsx");
const workerProfile = read("src/app/api/hcm/worker-profile/route.ts");
const nav = read("src/components/workspace/nav.ts");
const workspace = read("src/components/linaw-workspace.tsx");
const employeesRoute = read("src/app/api/employees/route.ts");
const recruitmentHire = read("src/app/api/recruitment/hire/route.ts");
const transfer = read("src/app/api/workforce-planning/transfer/route.ts");

test("HCM document-policy migration and schema preserve versioned evidence", () => {
  for (const table of [
    "hcm_policy_versions",
    "hcm_policy_assignments",
    "hcm_document_requirements",
    "hcm_employee_document_compliance",
  ]) {
    assert.ok(schema.includes(`"${table}"`), `schema missing ${table}`);
    assert.ok(migration.includes(`"${table}"`), `migration missing ${table}`);
  }
  assert.ok(schema.includes("contentSha256"));
  assert.ok(schema.includes("acknowledgementSha256"));
  assert.ok(schema.includes("acknowledgementEvidence"));
  assert.ok(schema.includes("expiryRequired"));
  assert.ok(schema.includes("renewalLeadDays"));
  assert.ok(migration.includes("hcm_policy_version_unique"));
  assert.ok(migration.includes("hcm_policy_assignment_unique"));
  assert.ok(migration.includes("hcm_employee_document_requirement_unique"));
});

test("policy publishing is company-wide, MFA protected, targeted, and published versions are immutable", () => {
  assert.ok(adminApi.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(adminApi.includes("Company-wide People access is required"));
  assert.ok(adminApi.includes("requireSensitiveActionMfa"));
  assert.ok(adminApi.includes('action === "save-policy-draft"'));
  assert.ok(adminApi.includes('action === "publish-policy"'));
  assert.ok(adminApi.includes('existing.status !== "draft"'));
  assert.ok(adminApi.includes("Published policy versions are immutable"));
  assert.ok(adminApi.includes("contentSha256"));
  assert.ok(adminApi.includes("materializePolicyAssignments"));
  assert.ok(adminApi.includes("targetedEmployees"));
});

test("employee acknowledgement is self-scoped and binds exact policy content into immutable evidence", () => {
  assert.ok(selfApi.includes('user.role !== "employee"'));
  assert.ok(selfApi.includes("user.employeeId"));
  assert.ok(selfApi.includes("eq(hcmPolicyAssignments.employeeId, employee.id)"));
  assert.ok(selfApi.includes('row.policy.status !== "published"'));
  assert.ok(selfApi.includes('row.assignment.status === "acknowledged"'));
  assert.ok(selfApi.includes("policyContentSha256"));
  assert.ok(selfApi.includes("acknowledgementSha256"));
  assert.ok(selfApi.includes("acknowledgedAt.toISOString()"));
  assert.ok(selfApi.includes("I acknowledge that I have received and read this exact policy version."));
  assert.equal(selfApi.includes("employeeId = Number(body.employeeId"), false);
});

test("HR waiver cannot overwrite employee acknowledgement evidence", () => {
  assert.ok(adminApi.includes('assignment.status === "acknowledged"'));
  assert.ok(adminApi.includes("Acknowledged evidence is immutable and cannot be replaced by a waiver."));
  assert.ok(adminApi.includes("waiverReason"));
  assert.ok(adminApi.includes("Policy acknowledgement requirement waived"));
});

test("required document uploads remain submitted until HR verification", () => {
  assert.ok(uploadApi.includes("requirementId"));
  assert.ok(uploadApi.includes('status: "submitted"'));
  assert.ok(uploadApi.includes("verifiedAt: null"));
  assert.ok(uploadApi.includes("verifiedByUserId: null"));
  assert.ok(adminApi.includes('action === "verify-document"'));
  assert.ok(adminApi.includes("documentComplianceStatus"));
  assert.ok(adminApi.includes("This requirement needs an expiry date before verification."));
});

test("secure document viewing is employee-owner or People-scope bound", () => {
  assert.ok(viewApi.includes("document.employeeId !== user.employeeId"));
  assert.ok(viewApi.includes("assertOrganizationRole"));
  assert.ok(viewApi.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(viewApi.includes('Cache-Control": "private, no-store"'));
  assert.ok(viewApi.includes('X-Content-Type-Options'));
  assert.ok(viewApi.includes("malware scanning has not verified it as clean"));
  assert.ok(viewApi.includes("params: Promise<{ id: string }>"));
});

test("document expiry is a live scheduled Automation Studio event", () => {
  assert.ok(automation.includes('"document.expires"'));
  const liveStart = automation.indexOf("AUTOMATION_LIVE_TRIGGERS");
  const plannedStart = automation.indexOf("AUTOMATION_PLANNED_TRIGGERS");
  assert.ok(automation.slice(liveStart, plannedStart).includes('"document.expires"'));
  assert.ok(automation.includes('value: "documentRequirementCode"'));
  assert.ok(automation.includes('value: "documentKind"'));
  assert.ok(automation.includes('value: "daysUntilExpiry"'));
  assert.ok(hcm.includes('trigger: "document.expires"'));
  assert.ok(hcm.includes("document-expiry:"));
  assert.ok(scheduler.includes("runScheduledHcmDocumentExpiry"));
  assert.ok(scheduler.includes('"hcm-document-expiry"'));
  assert.ok(scheduler.includes("6 * 60 * 60 * 1000"));
});

test("future hires and worker moves receive matching HCM obligations without deleting history", () => {
  assert.ok(hcm.includes("syncEmployeeHcmObligations"));
  assert.ok(hcm.includes(".onConflictDoNothing()"));
  assert.equal(hcm.includes("delete(hcmPolicyAssignments)"), false);
  assert.equal(hcm.includes("delete(hcmEmployeeDocumentCompliance)"), false);
  assert.ok(employeesRoute.includes("syncEmployeeHcmObligations"));
  assert.ok(recruitmentHire.includes("syncEmployeeHcmObligations"));
  assert.ok(transfer.includes("syncEmployeeHcmObligations"));
});

test("Documents workspace exposes policy, acknowledgement, missing-doc and renewal controls", () => {
  assert.ok(adminPanel.includes("DOCUMENTS &amp; POLICIES"));
  assert.ok(adminPanel.includes("Who has not acknowledged?"));
  assert.ok(adminPanel.includes("DOCUMENT COMPLIANCE"));
  assert.ok(adminPanel.includes("Upload securely"));
  assert.ok(adminPanel.includes("Verify"));
  assert.ok(adminPanel.includes("Published policy versions are immutable"));
  assert.ok(nav.includes('{ name: "Documents"'));
  assert.ok(workspace.includes("<HcmDocumentsPanel"));
});

test("employee self-service includes Documents and only acknowledges its own assignment", () => {
  assert.ok(employeePortal.includes('["documents", "Documents"]'));
  assert.ok(employeePortal.includes("<EmployeeDocumentsPanel"));
  assert.ok(employeePanel.includes("I acknowledge that I have received and read this exact policy version."));
  assert.ok(employeePanel.includes("/api/self/documents"));
  assert.ok(employeePanel.includes('form.set("requirementId"'));
  assert.ok(employeePanel.includes("remains Submitted until HR verifies it"));
});

test("connected worker profile surfaces policy and document risk without copying source data", () => {
  assert.ok(workerProfile.includes("hcmPolicyAssignments"));
  assert.ok(workerProfile.includes("hcmEmployeeDocumentCompliance"));
  assert.ok(workerProfile.includes("pendingPolicyAcknowledgements"));
  assert.ok(workerProfile.includes("documentComplianceRisks"));
  assert.ok(people.includes("pending policy acknowledgement"));
  assert.ok(people.includes("document item"));
});
