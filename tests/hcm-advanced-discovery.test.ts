import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PLAN_FEATURES, type PlanId } from "../src/lib/billing-matrix";
import { advancedHcmLinks, canDiscoverAdvancedHcm } from "../src/lib/hcm-advanced-discovery";
import { buildHcmNavigation } from "../src/lib/hcm-context-navigation";

function tier(plan: PlanId, active = true) {
  return { plan, active, features: PLAN_FEATURES[plan] };
}
const admin = { role: "hr", companyWide: true };
const flags = {
  HCM_PEOPLE_HOME_ENABLED: "true",
  NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED: "true",
  HCM_PEOPLE_HOME_ORG_IDS: "17",
  HCM_PROCESS_MONITOR_ENABLED: "true",
  NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED: "true",
  HCM_PROCESS_MONITOR_ORG_IDS: "17",
  NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS: "17",
  HCM_ORG_EXPLORER_ENABLED: "true",
  NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED: "true",
  HCM_ORG_EXPLORER_ORG_IDS: "17",
  NEXT_PUBLIC_HCM_ORG_EXPLORER_ORG_IDS: "17",
};

test("advanced HCM discovery is strictly Enterprise + active + company-wide authorized HR", () => {
  assert.ok(!PLAN_FEATURES.Core.includes("advanced-hcm-discovery"));
  assert.ok(!PLAN_FEATURES.Scale.includes("advanced-hcm-discovery"));
  assert.ok(PLAN_FEATURES.Enterprise.includes("advanced-hcm-discovery"));
  for (const plan of ["Solo", "Core", "Scale"] as const) {
    assert.equal(canDiscoverAdvancedHcm(admin, tier(plan)), false, plan);
  }
  assert.equal(canDiscoverAdvancedHcm(admin, tier("Enterprise")), true);
  assert.equal(canDiscoverAdvancedHcm(admin, tier("Enterprise", false)), false);
  for (const role of ["manager", "employee", "payroll", "checker", "bookkeeper"]) {
    assert.equal(canDiscoverAdvancedHcm({ role, companyWide: true }, tier("Enterprise")), false, role);
  }
  assert.equal(canDiscoverAdvancedHcm({ role: "hr", companyWide: false }, tier("Enterprise")), false);
  assert.equal(canDiscoverAdvancedHcm(null, tier("Enterprise")), false);
  assert.equal(canDiscoverAdvancedHcm(admin, null), false);
  assert.equal(canDiscoverAdvancedHcm(admin, { ...tier("Enterprise"), features: [] }), false);
});

test("advanced navigation exposes only already-available source destinations for selected employer", () => {
  const available = buildHcmNavigation({ organizationId: 17, access: admin, current: "peopleHome" }, flags);
  assert.deepEqual(
    advancedHcmLinks(admin, tier("Enterprise"), available).map(link => link.id),
    ["processMonitor", "actionCenter", "orgExplorer"],
  );
  assert.deepEqual(advancedHcmLinks(admin, tier("Core"), available), []);
  assert.deepEqual(advancedHcmLinks({role:"manager",companyWide:false}, tier("Enterprise"), available), []);
  const foreign = buildHcmNavigation({ organizationId: 18, access: admin, current: "peopleHome" }, flags);
  assert.deepEqual(advancedHcmLinks(admin, tier("Enterprise"), foreign), []);
  const monitorOff = buildHcmNavigation({ organizationId: 17, access: admin, current: "peopleHome" },
    { ...flags, HCM_PROCESS_MONITOR_ENABLED: "false" });
  assert.ok(!advancedHcmLinks(admin, tier("Enterprise"), monitorOff).some(x => x.id === "processMonitor"));
});

test("simple People Home collapses advanced navigation, with paid discovery and no new decision endpoint", () => {
  const page = readFileSync("src/app/hcm/command-center/page.tsx", "utf8");
  const nav = readFileSync("src/components/hcm-context-navigation.tsx", "utf8");
  assert.ok(page.includes("await getEntitlements(organizationId)"));
  assert.ok(page.includes("advancedHcmLinks("));
  assert.ok(page.includes("<details"));
  assert.ok(page.includes("Advanced HCM tools"));
  assert.ok(page.includes("simpleHome"));
  assert.ok(nav.includes('"processMonitor", "orgExplorer", "actionCenter"'));
  assert.ok(!page.includes('method: "POST"'));
  assert.ok(!page.includes('method: "PATCH"'));
});

test("global employee search never puts wages into a shortcut", () => {
  const palette = readFileSync("src/components/workspace/command-palette.tsx", "utf8");
  assert.ok(palette.includes("row.employee.employeeNo} · ${row.employee.title}"));
  assert.ok(!palette.includes("row.employee.basicRate"));
  assert.ok(!palette.includes("money(row.employee"));
});
