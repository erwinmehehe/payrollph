import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/hcm/worker-profile/route.ts", "utf8");
const people = readFileSync("src/components/workspace/people.tsx", "utf8");

test("connected worker profile is people-admin and organization-unit scoped", () => {
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
});

test("connected worker profile assembles governed HCM systems instead of copying them", () => {
  for (const source of [
    "positionAssignments",
    "positions",
    "jobProfiles",
    "benefitEnrollments",
    "benefitPlans",
    "assets",
    "provisioningTasks",
    "automationExecutions",
    "separationRecords",
    "users",
    "userOrganizations",
    "scimIdentities",
    "externalIdentities",
    "permissionSets",
  ]) {
    assert.ok(route.includes(source), `missing connected source ${source}`);
  }
  assert.equal(route.includes("db.insert("), false);
  assert.equal(route.includes("db.update("), false);
  assert.equal(route.includes("db.delete("), false);
});

test("connected profile preserves authoritative position and manager context", () => {
  assert.ok(route.includes("isNull(positionAssignments.effectiveUntil)"));
  assert.ok(route.includes("managerEmployeeId"));
  assert.ok(route.includes("effectiveFrom: String(assignment.effectiveFrom)"));
  assert.ok(route.includes("authoritativePosition: Boolean(position)"));
});

test("connected profile exposes access provisioning and joiner-mover-leaver evidence", () => {
  assert.ok(route.includes("scimManaged"));
  assert.ok(route.includes("linkedLogin"));
  assert.ok(route.includes("openLifecycleTasks"));
  assert.ok(route.includes("ruleName"));
  assert.ok(route.includes("separationOpen"));
});

test("People presents the worker profile as one HCM control surface", () => {
  assert.ok(people.includes("CONNECTED WORKER PROFILE"));
  assert.ok(people.includes("People, position, access and lifecycle in one record"));
  assert.ok(people.includes("/api/hcm/worker-profile"));
  assert.ok(people.includes("ACCESS &amp; IDENTITY"));
  assert.ok(people.includes("LIFECYCLE TASKS"));
  assert.ok(people.includes("not a second source of truth"));
});

test("sensitive access context is loaded only for people managers", () => {
  assert.ok(people.includes("if (!canManage)"));
  assert.ok(people.includes("{canManage && ("));
});


test("connected worker profile includes governed worksite evidence", () => {
  assert.ok(route.includes("hcmWorkArrangements"));
  assert.ok(route.includes("hcmWorksiteAuthorizations"));
  assert.ok(route.includes("employeeWorksiteAssignments"));
  assert.ok(route.includes("worksiteGovernance"));
  assert.ok(route.includes("primaryWorksite"));
  assert.ok(route.includes("authorizations"));
  assert.ok(route.includes("decision"));
});

test("People surfaces work arrangement and worksite access evidence", () => {
  assert.ok(people.includes("Work arrangement"));
  assert.ok(people.includes("Worksite access"));
  assert.ok(people.includes("worksiteGovernance"));
});
