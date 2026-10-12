import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CORE_ONLY_PAGES, NAVIGATION, tenantVisiblePages, normalizedTenantModuleVisibility } from "../src/components/workspace/nav";
test("new tenant navigation snapshot: only core modules", () => {
  const all = NAVIGATION.flatMap(group => group.items.map(item => item.name));
  assert.deepEqual(tenantVisiblePages(all, "core_only"), ["Overview", "Payroll", "People", "Time & attendance", "Analytics", "Settings"]);
  assert.equal(CORE_ONLY_PAGES.length, 6);
});
test("existing tenant navigation snapshot: unchanged permitted pages", () => {
  const oldPages = NAVIGATION.flatMap(group => group.items.map(item => item.name)).filter(p => p !== "More modules");
  assert.deepEqual(tenantVisiblePages(oldPages, "all"), oldPages);
});
test("enabling modules cannot widen access beyond assigned role", () => {
  assert.deepEqual(tenantVisiblePages(["Overview","Payroll","Settings","Expenses"], "core_only", ["Expenses","Automation"]), ["Overview","Payroll","Settings","Expenses"]);
  assert.deepEqual(tenantVisiblePages(["Overview","Settings"], "core_only", ["Expenses"]), ["Overview","Settings"]);
});
test("malformed or absent visibility never widens role-based navigation", () => {
  for (const input of [undefined, null, "", "ALL", "all ", "unexpected"]) {
    assert.equal(normalizedTenantModuleVisibility(input), "core_only");
  }
  assert.equal(normalizedTenantModuleVisibility("all"), "all");
  assert.equal(normalizedTenantModuleVisibility("core_only"), "core_only");
  const allowed = ["Overview", "Payroll", "Settings", "Expenses"];
  assert.deepEqual(tenantVisiblePages(allowed, normalizedTenantModuleVisibility("ALL")),
    ["Overview", "Payroll", "Settings"]);
});

test("existing rows remain full menu; new inserts receive core-only default", () => {
  const sql = readFileSync("docs/engineering/migration-proposals/tenant-core-navigation.sql","utf8");
  assert.match(sql, /DEFAULT 'all'/);
  assert.match(sql, /ALTER COLUMN module_visibility SET DEFAULT 'core_only'/);
});
