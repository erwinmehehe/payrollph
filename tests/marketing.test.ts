import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("the root route owns the public payroll software landing page", () => {
  const root = read("src/app/page.tsx");
  const welcome = read("src/app/welcome/page.tsx");
  assert.ok(root.includes("SoftwareHome"), "signed-out root must render the product landing page");
  assert.ok(root.includes("Payroll Software Philippines"), "root metadata must target payroll software intent");
  assert.ok(welcome.includes('permanentRedirect("/")'), "/welcome must redirect to the canonical root");
});

test("pricing is read from the database, never hardcoded in the homepage UI", () => {
  const page = read("src/components/marketing/software-home.tsx");
  const catalog = read("src/lib/pricing-catalog.ts");

  assert.ok(page.includes("getPublicPricingPlans"), "homepage must load pricing through the database pricing helper");
  assert.ok(catalog.includes('from "@/db/schema"'), "pricing helper must use the database schema");
  assert.ok(catalog.includes("pricingPlans"), "pricing helper must read the pricingPlans table");
  assert.ok(catalog.includes(".select()"), "pricing helper must select persisted pricing rows");
  assert.ok(!/₱\s?1,499|₱\s?4,499|₱\s?12,999/.test(page), "prices must not be hardcoded in the page");
});

test("the software homepage keeps the interactive payroll simulation", () => {
  const page = read("src/components/marketing/software-home.tsx");
  assert.ok(page.includes('<WorkspacePreview mode="interactive" />'), "interactive payroll simulation must remain mounted");
  assert.ok(page.includes('id="simulation"'), "homepage must expose a stable simulation section anchor");
  assert.ok(page.includes("Try the payroll workspace yourself."), "simulation section must explain what visitors can do");
});

test("the homepage stays customer-facing instead of restoring engineering-heavy proof blocks", () => {
  const page = read("src/components/marketing/software-home.tsx");

  assert.ok(page.includes("Philippine payroll, without the guesswork."), "homepage must keep the simplified payroll positioning");
  assert.ok(page.includes("One flow from cutoff to release."), "homepage must keep the clear payroll workflow");
  assert.ok(!page.includes("Sprout"), "competitor comparison should not return to the homepage");
  assert.ok(!page.includes("PayrollHero"), "competitor comparison should not return to the homepage");
  assert.ok(!page.includes("<StatutoryLab"), "the removed statutory lab must not be required by the homepage contract");
});

test("a dedicated role-based demo page exists", () => {
  assert.ok(existsSync("src/app/demo/page.tsx"), "role demo page must exist");
  assert.ok(existsSync("src/components/marketing/demo-role-picker.tsx"), "role demo picker must exist");

  const demo = read("src/components/marketing/demo-role-picker.tsx");
  const roles = read("src/lib/demo-roles.ts");
  assert.ok(demo.includes("See Linaw from the seat you actually use."), "demo page must explain the role-based experience");
  for (const role of ["owner", "hr", "payroll", "checker", "employee"]) {
    assert.ok(roles.includes(`"${role}"`), `demo roles must include ${role}`);
  }
  for (const removed of ["bookkeeper", "manager", "freelancer"]) {
    assert.ok(!roles.includes(`"${removed}"`), `public sandbox should not expose legacy persona ${removed}`);
  }
});

test("payroll outsourcing has its own service route and conversion path", () => {
  assert.ok(existsSync("src/app/payroll-outsourcing/page.tsx"), "payroll outsourcing page must exist");
  assert.ok(existsSync("src/components/marketing/payroll-quote-form.tsx"), "outsourcing quote form must exist");
  assert.ok(existsSync("src/app/api/payroll-outsourcing/quote/route.ts"), "outsourcing enquiry endpoint must exist");

  const page = read("src/app/payroll-outsourcing/page.tsx");
  assert.ok(page.includes("Payroll Outsourcing Philippines"), "service metadata must target outsourcing intent");
  assert.ok(page.includes("Get a payroll quote"), "service page must use a quote CTA");
  assert.ok(!page.includes("PricingTable"), "outsourcing page must not reuse product pricing");
});


test("homepage simulation uses the real workspace navigation and no dead client states", () => {
  const preview = read("src/components/marketing/workspace-preview.tsx");
  assert.ok(preview.includes('from "@/components/workspace/nav"'), "homepage preview must consume the workspace navigation contract");
  assert.ok(preview.includes("NAVIGATION"), "homepage preview must derive its navigation from the real app");
  assert.ok(!preview.includes("not part of this simulation"), "homepage preview must not expose dead client switch states");
  assert.ok(!preview.includes("client.id !== 1"), "homepage preview must not branch into disconnected client datasets");
});

test("homepage pricing uses the compact business pricing composition", () => {
  const pricing = read("src/components/marketing/pricing-table.tsx");
  assert.ok(pricing.includes("business-pricing-grid"), "business tiers must use the compact pricing grid");
  assert.ok(pricing.includes("pricing-estimator"), "pricing must keep a simple headcount estimator");
  assert.ok(!pricing.includes('type="range"'), "pricing must not restore the oversized headcount slider");
});

test("role demo launches the same product instead of rendering a second fake app", () => {
  const demo = read("src/components/marketing/demo-role-picker.tsx");
  assert.ok(demo.includes("Sandbox task"), "role page must explain the action-oriented sandbox handoff");
  assert.ok(!demo.includes("previewSidebar"), "role page must not maintain a second fake app navigation");
  assert.ok(!demo.includes("PreviewRow"), "role page must not maintain a separate fake payroll table");
});


test("role sandbox uses five real identities and provisions the checker for payroll handoff", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  const roles = read("src/lib/demo-roles.ts");
  const access = read("src/lib/access.ts");
  const dashboard = read("src/lib/dashboard-data.ts");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(route.includes("for (const role of DEMO_ROLE_IDS)"), "opening any persona must provision the complete five-role handoff");
  assert.ok(route.includes('membershipRole: "checker"'), "checker must be a real organization role");
  assert.ok(access.includes('"checker"] as const'), "checker must be present in payroll review permissions");
  assert.ok(dashboard.includes('access.role === "checker"'), "checker dashboard must be scoped to assigned approvals");
  assert.ok(roles.includes('"Payroll Officer"') && roles.includes('"HR Admin"') && roles.includes('"Checker"'), "public persona labels must match the sandbox");
  assert.ok(workspace.includes("demoInfo.actions.join"), "workspace must show the persona mission after launch");
  assert.ok(workspace.includes("onSwitchRole={demoRole ?"), "persona switching must only appear in demo sessions");
});

test("employee sandbox supports instant persona switching without exposing other employees", () => {
  const selfService = read("src/components/self-service-portal.tsx");
  assert.ok(selfService.includes("switchDemoRole"), "employee self-service must support instant demo persona switching");
  assert.ok(selfService.includes('role.id !== "employee"'), "employee persona switcher must offer the other sandbox roles");
  assert.ok(selfService.includes("/api/self/payslips"), "employee sandbox must stay on the self-scoped payslip API");
});
