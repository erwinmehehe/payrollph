import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("the root route always owns the public payroll software landing page", () => {
  const root = read("src/app/page.tsx");
  const app = read("src/app/app/page.tsx");
  const workspaceRedirect = read("src/app/workspace/page.tsx");
  const welcome = read("src/app/welcome/page.tsx");
  assert.ok(root.includes("SoftwareHome"), "root must render the public product landing page");
  assert.ok(!root.includes("getSessionUser"), "a signed-in session must not replace the public homepage");
  assert.ok(root.includes("Payroll Software Philippines"), "root metadata must target payroll software intent");
  assert.ok(app.includes("getSessionUser"), "/app must own authenticated session routing");
  assert.ok(app.includes('redirect("/login")'), "anonymous app visitors must be sent to sign in");
  assert.ok(app.includes('user.role === "employee"'), "employee self-service must live under /app too");
  assert.ok(workspaceRedirect.includes('permanentRedirect(`/app${suffix}`)'), "legacy /workspace links must redirect to /app");
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

test("the software homepage uses the real Linaw workspace preview", () => {
  const home = read("src/components/marketing/claude-home/App.tsx");
  const demo = read("src/components/marketing/claude-home/components/Demo.tsx");
  assert.ok(home.includes("<Demo />"), "redesigned homepage must mount the product demo");
  assert.ok(demo.includes('id="demo"'), "homepage must expose a stable live-demo anchor");
  assert.ok(demo.includes('from "@/components/marketing/workspace-preview"'), "homepage demo must use the shared Linaw workspace preview");
  assert.ok(demo.includes('<WorkspacePreview mode="interactive" />'), "homepage demo must expose the interactive real-system preview");
  assert.ok(demo.includes("Open role-based sandbox"), "homepage demo must hand off to the real role-based sandbox");
});

test("the homepage leads with the approved PayrollPH hero", () => {
  const hero = read("src/components/marketing/claude-home/components/Hero.tsx");
  const trust = read("src/components/marketing/claude-home/components/Trust.tsx");
  const product = read("src/components/marketing/claude-home/components/Product.tsx");

  assert.ok(hero.includes("Payroll that stays clear"), "hero must lead with the approved payroll headline");
  assert.ok(hero.includes("compliant, and under control."), "hero must complete the approved headline");
  assert.ok(hero.includes("Try Live Demo"), "hero must expose the primary live-demo CTA");
  assert.ok(hero.includes("See Pricing"), "hero must expose the pricing CTA");
  assert.ok(hero.includes("DOLE-compliant calculations"), "hero must show the first trust point");
  assert.ok(hero.includes("Government reports ready"), "hero must show the second trust point");
  assert.ok(hero.includes("Secure and confidential"), "hero must show the third trust point");
  assert.ok(hero.includes("Let’s make payroll easier"), "hero must include the owl speech bubble");
  assert.ok(product.includes("Drag a salary. Watch every deduction explain itself."), "statutory explanation must stay visible below the fold");
  assert.ok(trust.includes("Controls that return 403, not a tooltip."), "security controls must remain a primary product story");
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

test("homepage pricing keeps persisted plan values inside the redesigned cards", () => {
  const wrapper = read("src/components/marketing/software-home.tsx");
  const pricing = read("src/components/marketing/claude-home/components/Pricing.tsx");
  assert.ok(wrapper.includes("getPublicPricingPlans"), "homepage must continue loading persisted pricing");
  assert.ok(wrapper.includes("<ClaudeHomepage plans={plans} />"), "database pricing must flow into the redesign");
  assert.ok(pricing.includes("monthlyBase"), "redesigned pricing must use the persisted monthly base");
  assert.ok(pricing.includes("perEmployee"), "redesigned pricing must use the persisted per-employee price");
  assert.ok(!pricing.includes("modules.map"), "redesigned pricing must explain buyer outcomes instead of dumping module names");
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


test("real workspace navigation keeps module colors and profile interaction", () => {
  const shell = read("src/components/workspace/shell.tsx");
  const css = read("src/app/workspace-theme.css");
  assert.ok(shell.includes("data-tone={item.tone}"), "real workspace nav must expose each module tone");
  assert.ok(css.includes('.nav-item[data-tone="green"]'), "green workspace navigation tint must exist");
  assert.ok(css.includes('.nav-item[data-tone="purple"]'), "purple workspace navigation tint must exist");
  assert.ok(css.includes('.nav-item[data-tone="red"]'), "red workspace navigation tint must exist");
  assert.ok(shell.includes('className="side-profile"'), "profile control must remain interactive");
  assert.ok(css.includes(".side-profile-avatar > i"), "profile avatar must keep its presence indicator");
  assert.ok(!css.includes("background: #eeeeef;\n  color: #686d76;"), "avatar variants must not be flattened back to gray");
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

test("homepage People simulation can add and inspect employees", () => {
  const preview = read("src/components/marketing/workspace-preview.tsx");
  const css = read("src/components/marketing/software-home.module.css");
  assert.ok(preview.includes("function PeopleDemo"), "People must have a dedicated interactive demo");
  assert.ok(preview.includes("function addEmployee"), "People demo must support adding a local employee");
  assert.ok(preview.includes("Import people"), "People demo must link into migration");
  assert.ok(preview.includes("preview-people-overlay"), "People rows must open an employee detail surface");
  assert.ok(preview.includes("Government IDs"), "employee detail must show payroll-relevant identity state");
  assert.ok(css.includes("/* People demo */"), "premium homepage must include the scoped People demo styles");
  assert.ok(css.includes(".preview-people-drawer"), "People detail/add flow must have a designed drawer");
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


test("homepage hero uses the PayrollPH dashboard visual while the deeper demo stays interactive", () => {
  const hero = read("src/components/marketing/claude-home/components/Hero.tsx");
  const demo = read("src/components/marketing/claude-home/components/Demo.tsx");
  assert.ok(hero.includes("Good morning, Maria!"), "hero visual must use the approved PayrollPH dashboard composition");
  assert.ok(hero.includes("3 things need attention"), "hero visual must show the attention card");
  assert.ok(hero.includes("Recent Payroll Runs"), "hero visual must include recent payroll history");
  assert.ok(hero.includes("Ready for review"), "hero visual must include payroll status");
  assert.ok(demo.includes("WorkspacePreview"), "homepage demo must render the shared workspace preview");
  assert.ok(demo.includes("actual Linaw workspace"), "homepage demo must explain that it is showing the product system");
});

test("pricing explains who each plan is for instead of dumping internal module names", () => {
  const pricing = read("src/components/marketing/pricing-table.tsx");
  assert.ok(pricing.includes("BUYER_POINTS"), "pricing must use buyer-oriented outcomes");
  assert.ok(pricing.includes("Checker approvals, audit trail and stronger controls"), "Scale must explain operational value");
  assert.ok(!pricing.includes("modules.map"), "pricing must not dump persisted module names directly into the cards");
});

test("homepage demo delegates role boundaries to the real sandbox", () => {
  const demo = read("src/components/marketing/claude-home/components/Demo.tsx");
  const roles = read("src/lib/demo-roles.ts");
  assert.ok(demo.includes('href="/demo"'), "homepage demo must link to the role-based sandbox");
  for (const role of ["owner", "hr", "payroll", "checker", "employee"]) {
    assert.ok(roles.includes(`"${role}"`), `real sandbox must keep ${role}`);
  }
});



test("homepage navigation exposes the real public site", () => {
  const nav = read("src/components/marketing/claude-home/components/Navbar.tsx");
  const home = read("src/components/marketing/claude-home/App.tsx");
  const footer = read("src/components/marketing/claude-home/components/Closing.tsx");
  const publicNavigation = read("src/components/marketing/public-navigation.ts");

  assert.ok(nav.includes("PUBLIC_PRIMARY_LINKS"), "homepage nav must use the shared public route map");
  assert.ok(footer.includes("PUBLIC_FOOTER_GROUPS"), "homepage footer must use the shared public route map");
  for (const route of ["/demo", "/payroll-outsourcing", "/scorecard"]) {
    assert.ok(publicNavigation.includes(`href: "${route}"`), `shared primary nav must expose ${route}`);
  }
  const primaryNavigation = publicNavigation.slice(
    publicNavigation.indexOf("PUBLIC_PRIMARY_LINKS"),
    publicNavigation.indexOf("PUBLIC_FOOTER_GROUPS"),
  );
  assert.ok(!primaryNavigation.includes('label: "Calculator"'), "calculator should not compete in primary navigation");
  assert.ok(!primaryNavigation.includes('label: "Security"'), "security should not compete in primary navigation");
  assert.ok(!home.includes("<Benchmarks />"), "benchmarks should not clutter the homepage");
  assert.ok(!home.includes("<Scorecard />"), "scorecard should live on its dedicated route");
  assert.ok(!home.includes("<Developers />"), "developer detail should not clutter the buyer homepage");
  assert.ok(publicNavigation.includes('{ label: "Capability scorecard", href: "/scorecard" }'), "footer must link to the scorecard route");
  assert.ok(publicNavigation.includes('{ label: "System status", href: "/status" }'), "footer must link to the system status route");
  assert.ok(publicNavigation.includes('{ label: "Book a demo", href: "/book-demo" }'), "footer must link to booking");
});


test("login auth screen stays focused and product-consistent", () => {
  const auth = read("src/components/auth-screen.tsx");
  assert.ok(auth.includes("Sign in to Linaw."));
  assert.ok(auth.includes("Welcome back."));
  assert.ok(auth.includes('backgroundColor: "#6161FF"'), "login primary action must use Linaw indigo");
  assert.ok(auth.includes("Show password") && auth.includes("Hide password"), "login should expose a password visibility control");
  assert.ok(auth.includes("hidden min-h-[520px]") && auth.includes("lg:flex"), "supporting auth story must be desktop-only so mobile stays focused");
  assert.ok(!auth.includes("Distributed rate limiting"), "login should not read like a security marketing page");
  assert.ok(!auth.includes("rounded-[22px] bg-[#11141F]"), "login should not keep the old heavy black demo promo");
});


test("login route omits the marketing footer", () => {
  const login = read("src/app/login/page.tsx");
  assert.ok(login.includes("<SiteNav />"), "login should keep shared navigation");
  assert.ok(!login.includes("<SiteFooter />"), "login should not render the full marketing footer");
});


test("homepage hero stays product-first without a mascot", () => {
  const hero = read("src/components/marketing/claude-home/components/Hero.tsx");
  assert.ok(!hero.includes('from "@/components/payroll-owl"'), "homepage hero must not import mascot assets");
  assert.ok(!hero.includes("PayrollOwlArt"), "homepage hero must not render an owl mascot");
  assert.ok(!hero.includes("payroll-hero-speech"), "homepage hero must not render mascot speech");
  assert.ok(hero.includes("payroll-hero-laptop"), "homepage must keep the PayrollPH product visual");
  assert.ok(hero.includes("payroll-hero-alert-icon"), "attention card must keep a neutral product icon");
});
