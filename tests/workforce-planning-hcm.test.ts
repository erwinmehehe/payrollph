import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("job architecture separates positions from employees", () => {
  assert.ok(schema.includes("export const jobProfiles = pgTable("));
  assert.ok(schema.includes('"job_profiles"'));
  assert.ok(schema.includes("export const workforcePlans = pgTable("));
  assert.ok(schema.includes('"workforce_plans"'));
  assert.ok(schema.includes("export const positions = pgTable("));
  assert.ok(schema.includes('"positions"'));
  assert.ok(schema.includes("export const positionAssignments = pgTable("));
  assert.ok(schema.includes('"position_assignments"'));
  assert.ok(schema.includes('jobProfileId: integer("job_profile_id")'));
  assert.ok(schema.includes('positionId: integer("position_id")'));
  assert.ok(schema.includes('effectiveFrom: date("effective_from")'));
});

test("planning API enforces role, tenant and organization-unit scope", () => {
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("getAccess(user.id, organizationId)"));
  assert.ok(route.includes("assertScope(companyAccess, employee.orgUnitId)"));
  assert.ok(route.includes("if (!companyAccess?.companyWide)"));
  assert.ok(route.includes("HCM_DIRECT_ASSIGNMENT_SCOPE_REQUIRED"));
  assert.ok(route.includes("This position is outside your assigned organization unit."));
});

test("organization-wide architecture and plans require People administration", () => {
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("Job architecture requires company-wide access."));
  assert.ok(route.includes("Workforce plans require company-wide access."));
});

test("position filling requires an effective-dated assignment", () => {
  assert.ok(route.includes('isNull(positionAssignments.effectiveUntil)'));
  assert.ok(route.includes('status: "filled"'));
  assert.ok(route.includes("A position can be marked filled only through an active employee assignment."));
  assert.ok(route.includes("db.transaction"));
});

test("planning mutations are same-origin protected and audited", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes('"Job profile created"'));
  assert.ok(route.includes('"Workforce plan created"'));
  assert.ok(route.includes('"Position creation submitted to HCM business process"'));
  assert.ok(route.includes("approvalRequired: true"));
  assert.ok(route.includes('"Employee assigned to position"'));
});

test("planning workspace is wired into navigation and rendering", () => {
  assert.ok(nav.includes('{ name: "Planning"'));
  assert.ok(workspace.includes('import { WorkforcePlanningPanel }'));
  assert.ok(workspace.includes('page === "Planning"'));
});
