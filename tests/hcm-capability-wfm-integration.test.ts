import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("WFM consumes HCM capability evidence at coverage, claim and approval boundaries", () => {
  const route = read("src/app/api/workforce/coverage/route.ts");
  const coverage = read("src/lib/workforce-coverage.ts");

  assert.ok(route.includes("loadCapabilityEligibilityData"));
  assert.ok(route.includes("evaluateEmployeeFromCapabilityData"));
  assert.ok(route.includes("loadEmployeeWfmEligibility"));
  assert.ok(route.includes("capabilityEvidenceIssues"));
  assert.ok(route.includes("does not meet the required skills or credentials"));
  assert.ok(route.includes("no longer meets the required skills or credentials"));
  assert.ok(coverage.includes("capabilityIneligibleHeadcount"));
  assert.ok(coverage.includes("ineligibleShiftDefinitionIds"));
});

test("capability administration is role controlled, scoped and audit logged", () => {
  const route = read("src/app/api/hcm/capabilities/route.ts");
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("assertScope"));
  assert.ok(route.includes("recordAuditEvent"));
  assert.ok(route.includes('action === "create_skill"'));
  assert.ok(route.includes('action === "set_job_skill"'));
  assert.ok(route.includes('action === "set_employee_skill"'));
  assert.ok(route.includes('action === "link_credential"'));
});

test("connected worker profile and People UI expose workforce eligibility", () => {
  const route = read("src/app/api/hcm/worker-profile/route.ts");
  const people = read("src/components/workspace/people.tsx");
  assert.ok(route.includes("workforceEligibility"));
  assert.ok(route.includes("jobSkillRequirements"));
  assert.ok(route.includes("jobCredentialRequirements"));
  assert.ok(people.includes("Workforce eligibility"));
  assert.ok(people.includes("HcmCapabilitiesPanel"));
  assert.ok(people.includes("Blocked from qualified role coverage"));
});
