import assert from "node:assert/strict";
import test from "node:test";
import { projectEnterprisePermissionReview, type EnterprisePermissionReviewInput } from "../src/lib/enterprise-permission-review";

const permissions = ["payroll.check", "payroll.release", "payroll.disburse"] as const;
const member = (membershipId: number, changes = {}) => ({
  membershipId, userId: membershipId + 100, role: "checker", orgUnitId: null,
  membershipActive: true, active: true, ...changes,
});
const base = (): EnterprisePermissionReviewInput => ({
  organizationId: 7, availablePermissions: permissions,
  members: [member(11), member(12), member(13, { membershipActive: false })],
  permissionSets: [
    { id: 3, organizationId: 7, name: "Restricted checker", active: true,
      permissions: ["payroll.check"] },
    { id: 4, organizationId: 8, name: "Foreign", active: true,
      permissions: [...permissions] },
  ],
  assignments: [
    { organizationId: 7, userOrganizationId: 11, permissionSetId: 3,
      dynamicGroupId: null, dynamicGroupVersion: null },
    { organizationId: 8, userOrganizationId: 12, permissionSetId: 4,
      dynamicGroupId: null, dynamicGroupVersion: null },
  ],
  groups: [{ id: 5, code: "finance", version: 2, active: true }],
});
test("review reports deny-only sets, never infers a grant from an unassigned base role", () => {
  const rows = projectEnterprisePermissionReview(base());
  assert.deepEqual(rows.map(row => row.state),
    ["deny-only-overlay", "base-role-only", "inactive-member"]);
  assert.deepEqual(rows[0]?.listedByOverlay, ["payroll.check"]);
  assert.deepEqual(rows[0]?.deniedByOverlay, ["payroll.release", "payroll.disburse"]);
  assert.deepEqual(rows[1]?.listedByOverlay, []);
  assert.deepEqual(rows[1]?.deniedByOverlay, []);
  assert.deepEqual(rows[2]?.listedByOverlay, []);
});
test("stale, disabled or cross-employer overlay references are not shown as permissions", () => {
  for (const change of [
    { permissionSetId: 4 }, { permissionSetId: 99 },
    { permissionSetId: 3, dynamicGroupId: 5, dynamicGroupVersion: 1 },
    { permissionSetId: 3, dynamicGroupId: 5, dynamicGroupVersion: null },
  ]) {
    const input = base();
    const row = projectEnterprisePermissionReview({
      ...input,
      assignments: [{ ...input.assignments[0]!, ...change }, ...input.assignments.slice(1)],
    })[0]!;
    assert.match(row.state, /invalid/);
    assert.deepEqual(row.listedByOverlay, []);
    assert.deepEqual(row.deniedByOverlay, [...permissions]);
  }
});
test("live dynamic-group eligibility remains unproven in read-only review", () => {
  const input = base();
  const row = projectEnterprisePermissionReview({
    ...input,
    assignments: [{ ...input.assignments[0]!, dynamicGroupId: 5, dynamicGroupVersion: 2 },
      ...input.assignments.slice(1)],
  })[0]!;
  assert.equal(row.state, "conditional-dynamic-group-overlay");
  assert.deepEqual(row.listedByOverlay, ["payroll.check"]);
  assert.equal(row.dynamicGroupId, 5);
});
test("invalid permissions and duplicate assignments fail closed in the review projection", () => {
  const malformed = base();
  assert.equal(projectEnterprisePermissionReview({
    ...malformed,
    permissionSets: [{ ...malformed.permissionSets[0]!,
      permissions: ["payroll.check", "imaginary.grant"] },
      ...malformed.permissionSets.slice(1)],
  })[0]?.state, "invalid-or-inactive-overlay");
  const duplicate = base();
  assert.equal(projectEnterprisePermissionReview({
    ...duplicate, assignments: [...duplicate.assignments, duplicate.assignments[0]!],
  })[0]?.state, "invalid-assignment");
});
