import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateDynamicGroupGate } from "../src/lib/dynamic-group-authorization";

const read = (path: string) => readFileSync(path, "utf8");

const conditions = {
  version: 1 as const,
  all: [
    { field: "department", operator: "eq" as const, value: "Operations" },
    { field: "verifiedSkillCodes", operator: "contains" as const, value: "shift-lead" },
  ],
  any: [],
};
const group = { id: 7, version: 3, active: true, conditions };
const context = {
  employeeId: 101,
  employeeStatus: "Active",
  orgUnitId: 10,
  department: "Operations",
  verifiedSkillCodes: ["shift-lead"],
};

test("a live group may narrow a verified worker's existing role or permission gate", () => {
  const result = evaluateDynamicGroupGate({
    group,
    expectedVersion: 3,
    context,
    memberOrgUnitId: 10,
    employeeId: 101,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "eligible");
  assert.equal(result.groupVersion, 3);
});

test("Dynamic Group eligibility fails closed when the group changes or is disabled", () => {
  assert.equal(evaluateDynamicGroupGate({
    group, expectedVersion: 2, context, memberOrgUnitId: 10, employeeId: 101,
  }).reason, "group_version_changed");
  assert.equal(evaluateDynamicGroupGate({
    group: { ...group, active: false }, expectedVersion: 3, context, memberOrgUnitId: 10, employeeId: 101,
  }).reason, "group_missing_or_inactive");
  assert.equal(evaluateDynamicGroupGate({
    group: { ...group, conditions: {} }, expectedVersion: 3, context, memberOrgUnitId: 10, employeeId: 101,
  }).reason, "invalid_group_definition");
});

test("worker identity and tenant-unit scope are authoritative", () => {
  const base = { group, expectedVersion: 3, context, memberOrgUnitId: 10, employeeId: 101 };
  assert.equal(evaluateDynamicGroupGate({ ...base, employeeId: null }).eligible, false);
  assert.equal(evaluateDynamicGroupGate({ ...base, employeeId: 202 }).reason, "worker_missing_or_inactive");
  assert.equal(evaluateDynamicGroupGate({ ...base, context: { ...context, employeeStatus: "Separated" } }).reason, "worker_missing_or_inactive");
  assert.equal(evaluateDynamicGroupGate({ ...base, memberOrgUnitId: 11 }).reason, "outside_membership_scope");
  assert.equal(evaluateDynamicGroupGate({ ...base, context: { ...context, verifiedSkillCodes: [] } }).reason, "not_group_member");
});

test("worker-account eligibility must use a tenant-scoped link, never name/email matching", () => {
  const authorization = read("src/lib/dynamic-group-authorization.ts");
  assert.ok(authorization.includes("userOrganizations.workerEmployeeId"));
  assert.ok(authorization.includes('membership.role === "employee" ? user.employeeId : null'));
  assert.ok(authorization.includes("loadWorkerAttributeContext"));
  assert.ok(authorization.includes("eq(dynamicWorkerGroups.organizationId, input.organizationId)"));
  assert.ok(authorization.includes('input.context.employeeStatus !== "Active"'));
  assert.ok(authorization.includes("memberOrgUnitId"));
  assert.equal(authorization.includes("eq(users.email, "), false);
});

test("group scopes remain deny-only overlays on existing role and direct permission-set gates", () => {
  const permissions = read("src/lib/permissions.ts");
  const access = read("src/lib/access.ts");
  assert.ok(permissions.includes("Permission sets are deny-only overlays"));
  assert.ok(permissions.includes("if (!permissions.includes(permission))"));
  assert.ok(permissions.includes("authorizedDynamicGroupMember({"));
  assert.ok(permissions.includes("expectedVersion: assignment.dynamicGroupVersion"));
  assert.ok(permissions.includes("allowed: eligibility.eligible"));
  assert.ok(access.includes("roleGateAllowed(userId, organizationId, permission)"));
  assert.ok(access.includes("!roleAllowed(access.role, allowedRoles)"));
});

test("admin-only explicit worker linking and permission assignment are MFA/rate limited, audited and demo safe", () => {
  const enterprise = read("src/app/api/enterprise/route.ts");
  const ui = read("src/components/enterprise-controls-panel.tsx");
  assert.ok(enterprise.includes('action === "link-membership-worker"'));
  assert.ok(enterprise.includes("membership.userId === user.id"));
  assert.ok(enterprise.includes("workerEmployeeId: employeeId"));
  assert.ok(enterprise.includes("employee.status !== \"Active\""));
  assert.ok(enterprise.includes("membership.orgUnitId !== employee.orgUnitId"));
  assert.ok(enterprise.includes("Owner or self-assigned permissions cannot be gated"));
  assert.ok(enterprise.includes("group.version"));
  assert.ok(enterprise.includes("dynamicGroupVersion"));
  assert.ok(enterprise.includes("requireSensitiveActionMfa"));
  assert.ok(enterprise.includes("rateLimitDistributed"));
  assert.ok(enterprise.includes("publicDemoMutationDenied"));
  assert.ok(enterprise.includes('action: "Workspace worker identity link updated"'));
  assert.ok(enterprise.includes('action: "Custom permission set assigned"'));
  assert.ok(ui.includes("VERIFIED WORKER"));
  assert.ok(ui.includes("DYNAMIC GROUP GUARD"));
  assert.ok(ui.includes('action: "link-membership-worker"'));
  assert.ok(ui.includes('action: "assign-permission-set"'));
});

test("approval group policy is additive to role or named routing and frozen per request", () => {
  const chains = read("src/lib/approval-chains.ts");
  const plans = read("src/app/api/workforce-planning/scenarios/route.ts");
  const admin = read("src/app/api/approval-chains/route.ts");
  const ui = read("src/components/approval-chain-admin.tsx");
  assert.ok(chains.includes("dynamicGroupCode?: string"));
  assert.ok(chains.includes("dynamicGroupVersion?: number"));
  assert.ok(chains.includes("freezeDynamicGroupApprovalSteps"));
  assert.ok(chains.includes("dynamicGroupId: group.id"));
  assert.ok(chains.includes("dynamicGroupVersion: group.version"));
  assert.ok(chains.includes("stepsSnapshot: routedSteps"));
  assert.ok(chains.includes("appliedSteps: routedSteps"));
  assert.ok(plans.includes("freezeDynamicGroupApprovalSteps(scenario.organizationId, eligibleSteps)"));
  assert.ok(plans.includes("stepsSnapshot: routedSteps"));
  assert.ok(admin.includes("await freezeDynamicGroupApprovalSteps(organizationId, steps)"));
  assert.ok(ui.includes("Required Dynamic Group"));
  assert.ok(ui.includes('dynamicGroupCode: event.target.value'));
});

test("live approval decision first proves named/role eligibility, then worker-group eligibility", () => {
  const approval = read("src/app/api/approvals/[id]/route.ts");
  const named = approval.indexOf("const decision = await canDecide(");
  const group = approval.indexOf("groupEligibility = await authorizedDynamicGroupMember(");
  assert.ok(named >= 0 && group > named);
  assert.ok(approval.includes("if (!decision.permitted)"));
  assert.ok(approval.includes("if (!groupEligibility.eligible)"));
  assert.ok(approval.includes("expectedVersion: dynamicGroupScope.version"));
  assert.ok(approval.includes("Payroll checker approvals cannot be reassigned by Dynamic Group"));
  assert.ok(approval.includes("Maker-checker control: the person who submitted"));
  assert.ok(approval.includes('APPROVAL_DYNAMIC_GROUP_NOT_ELIGIBLE'));
  assert.ok(approval.includes("membershipCheckedLive: true"));
  assert.ok(approval.includes("for share"));
});

test("changing a group cannot silently rewrite approval or permission policy dependencies", () => {
  const api = read("src/app/api/dynamic-worker-groups/route.ts");
  assert.ok(api.includes("dynamicGroupSecurityDependencies"));
  assert.ok(api.includes("permissionAssignmentCount"));
  assert.ok(api.includes("activeApprovalPolicyCount"));
  assert.ok(api.includes("Remove those bindings before editing its version."));
  assert.ok(api.includes("before disabling this Dynamic Group."));
  const ui = read("src/components/dynamic-worker-groups-panel.tsx");
  assert.ok(ui.includes("permissionAssignmentCount"));
  assert.ok(ui.includes("activeApprovalPolicyCount"));
});

test("schema, migration, fresh DB and compatibility path persist versioned authorization bindings", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0095_dynamic_group_authorization.sql");
  const baseline = read("drizzle/baseline.sql");
  const compat = read("src/lib/core-schema-compat.ts");
  for (const file of [schema, migration, baseline, compat]) {
    assert.ok(file.includes("worker_employee_id"));
    assert.ok(file.includes("dynamic_group_id"));
    assert.ok(file.includes("dynamic_group_version"));
    assert.ok(file.includes("user_org_worker_employee_unique"));
    assert.ok(file.includes("user_permission_assignments_group_pair_check"));
  }
});
