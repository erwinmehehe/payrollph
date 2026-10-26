import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { absentPermissionOverlayDecision, permissionOverlayKeysValid } from "../src/lib/permission-overlay-absence";

test("no assigned overlay retains base-role behavior", () => {
  assert.deepEqual(absentPermissionOverlayDecision(false), {
    allowed: true, restricted: false, permissionSet: null,
  });
});
test("dangling, foreign, deleted or missing assigned set cannot broaden a role", () => {
  const outcome = absentPermissionOverlayDecision(true);
  assert.deepEqual(outcome, { allowed: false, restricted: true,
    permissionSet: null, reason: "missing-assigned-permission-set" });
});
test("live role gate uses the fail-closed helper only on missing assigned sets", () => {
  const source = readFileSync("src/lib/permissions.ts", "utf8");
  assert.match(source, /if \(!permissionSet\) return absentPermissionOverlayDecision\(assignment !== null\)/);
  assert.match(source, /authorizedDynamicGroupMember/);
  assert.match(source, /!permissions.includes\(permission\)/);
});

test("a malformed overlay cannot partially authorize a recognized role gate", () => {
  const known = ["payroll.check", "payroll.release"] as const;
  assert.equal(permissionOverlayKeysValid(["payroll.check"], known), true);
  assert.equal(permissionOverlayKeysValid([], known), true);
  for (const invalid of [
    ["payroll.check", "unknown.grant"], ["payroll.check", 7],
    ["payroll.check", null], ["payroll.check", {}],
    "payroll.check", null, undefined,
  ]) {
    assert.equal(permissionOverlayKeysValid(invalid, known), false);
  }
});

test("live gate rejects inactive membership and every malformed overlay before checking grants", () => {
  const source = readFileSync("src/lib/permissions.ts", "utf8");
  const noMember = source.indexOf("if (!membership) return { allowed: false");
  const absent = source.indexOf("if (!permissionSet) return absentPermissionOverlayDecision");
  const malformed = source.indexOf("if (!permissionOverlayKeysValid(permissionSet.permissions, ROLE_GATE_PERMISSIONS))");
  const roleGate = source.indexOf("if (!permissions.includes(permission))");
  assert.ok(noMember >= 0 && absent > noMember,
    "Missing membership must be denied before base-role fallback");
  assert.ok(malformed > absent && roleGate > malformed,
    "Every malformed permission-set overlay must be denied before checking allowed gates");
});
