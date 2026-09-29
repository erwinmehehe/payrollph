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
  assert.ok(page.includes("Now try the workspace yourself."), "simulation section must explain what visitors can do");
});

test("the homepage leads with payroll control instead of a module catalogue", () => {
  const page = read("src/components/marketing/software-home.tsx");

  assert.ok(
    page.includes("Run Philippine payroll with a clear path from draft to release."),
    "hero must lead with the payroll lifecycle",
  );
  assert.ok(page.includes("Know what changed before anyone presses release."), "assurance must be a primary product story");
  assert.ok(page.includes("The rulebook belongs inside the payroll run."), "Philippine compliance must be visible");
  assert.ok(page.includes("Bring your payroll history with you."), "migration must be part of the switching story");
  assert.ok(page.includes("The HR tools stay close, without taking over the story."), "supporting HR modules must remain secondary");
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
  assert.ok(workspace.includes("DemoSandboxBar"), "workspace must show the task-driven persona sandbox after launch");
  assert.ok(workspace.includes("onSwitchRole={demoRole ?"), "persona switching must only appear in demo sessions");
});

test("employee sandbox supports instant persona switching without exposing other employees", () => {
  const selfService = read("src/components/self-service-portal.tsx");
  assert.ok(selfService.includes("switchDemoRole"), "employee self-service must support instant demo persona switching");
  assert.ok(selfService.includes("DemoSandboxBar"), "employee persona must use the shared instant role switcher");
  assert.ok(selfService.includes("/api/self/payslips"), "employee sandbox must stay on the self-scoped payslip API");
});


test("homepage simulation keeps colored module navigation and collapsible groups", () => {
  const preview = read("src/components/marketing/workspace-preview.tsx");
  const css = read("src/components/marketing/software-home.module.css");
  assert.ok(preview.includes("data-tone={tone}"), "module tone must reach the simulated nav item");
  assert.ok(preview.includes("pv-nav-group-toggle"), "workspace groups must be collapsible");
  assert.ok(preview.includes("collapsedGroups"), "collapsed nav state must be interactive");
  assert.ok(css.includes('nav-item[data-tone="green"]'), "green module tint must be defined");
  assert.ok(css.includes('nav-item[data-tone="purple"]'), "purple module tint must be defined");
  assert.ok(css.includes('nav-item[data-tone="teal"]'), "teal module tint must be defined");
  assert.ok(!css.includes("background: transparent;\n  color: #8d939d;"), "marketing CSS must not flatten all nav icons back to grey");
});

test("homepage Leave and Migration modules perform local interactive workflows", () => {
  const preview = read("src/components/marketing/workspace-preview.tsx");
  assert.ok(preview.includes("function PreviewLeave()"), "Leave must have a dedicated interactive preview");
  assert.ok(preview.includes('decide(row.id, "Approved")'), "Leave must support sample approval");
  assert.ok(preview.includes('decide(row.id, "Declined")'), "Leave must support sample decline");
  assert.ok(preview.includes("addSampleRequest"), "Leave must support adding a local sample request");
  assert.ok(preview.includes("function PreviewMigration"), "Migration must have a dedicated interactive preview");
  assert.ok(preview.includes('setStage("mapped")'), "Migration must simulate header mapping");
  assert.ok(preview.includes('setStage("validated")'), "Migration must simulate validation");
});


test("homepage hero uses a focused payroll showcase before the full interactive demo", () => {
  const page = read("src/components/marketing/software-home.tsx");
  const preview = read("src/components/marketing/workspace-preview.tsx");
  assert.ok(page.includes('<WorkspacePreview mode="focused" />'), "hero product frame must be a focused interactive preview");
  assert.ok(preview.includes('mode !== "showcase"'), "focused mode must remain interactive");
  assert.ok(preview.includes('"Payroll", "People", "Migration", "Approvals", "Compliance"'), "showcase nav must stay focused on high-value modules");
});

test("pricing explains who each plan is for instead of dumping internal module names", () => {
  const pricing = read("src/components/marketing/pricing-table.tsx");
  assert.ok(pricing.includes("BUYER_POINTS"), "pricing must use buyer-oriented outcomes");
  assert.ok(pricing.includes("Checker approvals, audit trail and stronger controls"), "Scale must explain operational value");
  assert.ok(!pricing.includes("modules.map"), "pricing must not dump persisted module names directly into the cards");
});

test("homepage public demo roles match the five real sandbox personas", () => {
  const page = read("src/components/marketing/software-home.tsx");
  for (const role of ["Owner", "HR Admin", "Payroll Officer", "Checker", "Employee"]) {
    assert.ok(page.includes(`"${role}"`), `homepage must expose the ${role} persona`);
  }
  for (const removed of ["Bookkeeper", "Manager", "Freelancer"]) {
    assert.ok(!page.includes(`"${removed}"`), `homepage must not advertise legacy role ${removed}`);
  }
});
