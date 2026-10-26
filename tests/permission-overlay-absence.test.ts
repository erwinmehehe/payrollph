import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { absentPermissionOverlayDecision } from "../src/lib/permission-overlay-absence";

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
