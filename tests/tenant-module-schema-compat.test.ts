import assert from "node:assert/strict";
import test from "node:test";
import { hasTenantModuleColumns } from "../src/lib/tenant-modules";
import { tenantNavigationGroups } from "../src/components/workspace/nav";

test("missing or partly migrated 0122 columns cannot enable module reads", () => {
  assert.equal(hasTenantModuleColumns([]), false);
  assert.equal(hasTenantModuleColumns(["module_navigation_mode"]), false);
  assert.equal(hasTenantModuleColumns(["enabled_modules"]), false);
  assert.equal(hasTenantModuleColumns(["enabled_modules", "module_navigation_mode"]), true);
});

test("flag-off navigation continues to expose the legacy menu for both org modes", () => {
  const former = tenantNavigationGroups({ enabled: false, mode: "all" });
  const unmigrated = tenantNavigationGroups({ enabled: false, mode: "core" });
  assert.deepEqual(unmigrated.map(g => g.items.map(i => i.name)), former.map(g => g.items.map(i => i.name)));
});
