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

test("obsolete standalone marketing prototypes stay removed", () => {
  assert.ok(!existsSync("landing/sahod-landing.html"), "legacy Sahod HTML landing page must not return");
  assert.ok(!existsSync("landing-v2/linaw-landing.html"), "legacy Linaw v2 HTML landing page must not return");
  assert.ok(!existsSync("src/components/marketing/software-home.module.css"), "abandoned software-home CSS module must stay removed");
  assert.ok(!existsSync("src/components/marketing/demo-role-picker.module.css"), "abandoned demo-role CSS module must stay removed");
  assert.ok(!existsSync("src/components/marketing/capability-grid.tsx"), "unused capability grid must stay removed");
  assert.ok(!existsSync("src/components/marketing/hero-actions.tsx"), "unused legacy hero actions must stay removed");
  assert.ok(!existsSync("src/components/marketing/pricing-table.tsx"), "unused legacy pricing component must stay removed");
  assert.ok(!existsSync("src/components/marketing/statutory-lab.tsx"), "unused legacy statutory lab must stay removed");
});


test("public SEO origin is payrollsoftware.ph and is independent of app deployment origin", () => {
  const siteUrl = read("src/lib/site-url.ts");
  const layout = read("src/app/layout.tsx");
  const home = read("src/app/page.tsx");
  const outsourcing = read("src/app/payroll-outsourcing/page.tsx");
  const robots = read("src/app/robots.ts");
  const sitemap = read("src/lib/sitemap-data.ts");

  assert.ok(siteUrl.includes('"https://payrollsoftware.ph"'), "canonical public fallback must be payrollsoftware.ph");
  assert.ok(!siteUrl.includes("process.env"), "public SEO origin must not vary with deployment environment");
  assert.ok(!siteUrl.includes("APP_BASE_URL"), "application deployment origin must not control public SEO canonicals");
  assert.ok(!siteUrl.includes("vercel.app"), "Vercel deployment URL must never be the canonical fallback");

  assert.ok(layout.includes("metadataBase: new URL(PUBLIC_SITE_URL)"), "all relative metadata URLs must resolve from the canonical public origin");
  assert.ok(robots.includes('absolutePublicUrl("/sitemap.xml")'), "robots sitemap must use the canonical public origin");
  assert.ok(sitemap.includes("absolutePublicUrl(path)"), "segmented sitemap entries must use the canonical public origin");
  assert.ok(home.includes('absolutePublicUrl("/#organization")'), "homepage schema must use an absolute canonical organization ID");
  assert.ok(outsourcing.includes('absolutePublicUrl("/payroll-outsourcing#service")'), "service schema must use the canonical public origin");
});


test("the software homepage uses the real Linaw workspace preview", () => {
  const home = read("src/components/marketing/claude-home/App.tsx");
  const demo = read("src/components/marketing/product-home-hero.tsx");
  assert.ok(home.includes("<ProductHomeHero />"), "redesigned homepage must mount the product demo");
  assert.ok(demo.includes('id="demo"'), "homepage must expose a stable live-demo anchor");
  assert.ok(demo.includes('from "@/components/marketing/linaw-simulation"'), "homepage demo must use the shared Linaw workspace preview");
  assert.ok(demo.includes('<LinawSimulation'), "homepage demo must expose the interactive real-system preview");
  assert.ok(demo.includes("Open role-based sandbox"), "homepage demo must hand off to the real role-based sandbox");
});

test("the homepage leads with the approved connected payroll and people hero", () => {
  const hero = read("src/components/marketing/product-home-hero.tsx");
  const home = read("src/components/marketing/claude-home/App.tsx");
  assert.ok(home.includes("<ProductHomeHero />"));
  assert.ok(home.includes("<ProductHomeStories />"));
  assert.ok(hero.includes("Your people. Your payroll."));
  assert.ok(hero.includes("Working together."));
  assert.ok(hero.includes('href="/demo"'));
  assert.ok(hero.includes('href="/book-demo"'));
  for (const area of ["Payroll", "Workforce Management", "HCM", "HRIS", "Workforce Analytics", "Employee Self-Service"]) assert.ok(hero.includes(area));
  assert.ok(hero.includes("aria-pressed={selected.id === area.id}"));
  assert.ok(hero.toLowerCase().includes("fictional sample data"));
});

test("a dedicated role-based demo page exists", () => {
  assert.ok(existsSync("src/app/demo/page.tsx"), "role demo page must exist");
  assert.ok(existsSync("src/components/marketing/demo-role-picker.tsx"), "role demo picker must exist");

  const demo = read("src/components/marketing/demo-role-picker.tsx");
  const roles = read("src/lib/demo-roles.ts");
  assert.ok(demo.includes("See Linaw from the seat you actually use."), "demo page must explain the role-based experience");
  for (const role of ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"]) {
    assert.ok(roles.includes(`"${role}"`), `demo roles must include ${role}`);
  }
  for (const removed of ["manager", "freelancer"]) {
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

test("homepage buyer flow keeps product evidence before pricing", () => {
  const home = read("src/components/marketing/claude-home/App.tsx");
  const stories = read("src/components/marketing/product-home-stories.tsx");
  assert.ok(home.indexOf("<ProductHomeStories />") < home.indexOf("<Pricing plans={plans} />"));
  assert.ok(stories.includes("Payroll Outsourcing Philippines"));
  assert.ok(home.includes("<ProductHomeHero />"));
  assert.ok(!home.includes("<Calculator />"));
  assert.ok(!stories.includes("One place for the work around payday."));
  assert.ok(stories.includes("Review security details"));
});

test("dedicated pricing page uses live catalog values and explains plan fit", () => {
  const page = read("src/app/pricing/page.tsx");
  assert.ok(page.includes("getPublicPricingPlans"), "pricing page must load the persisted pricing catalog");
  assert.ok(page.includes("plan.monthlyBase"), "pricing page must render the persisted monthly base");
  assert.ok(page.includes("plan.perEmployee"), "pricing page must render the persisted per-employee amount");
  assert.ok(page.includes("plan.modules"), "pricing page must expose the configured plan modules");
  assert.ok(page.includes("plan.version"), "pricing page must identify the active catalog version");
  assert.ok(page.includes("Example at {exampleHeads} employees"), "pricing page must make the pricing formula concrete");
  assert.ok(page.includes("faq={faq}"), "pricing page must publish pricing FAQs through shared structured data");
  assert.ok(page.includes("Which plan should a growing payroll team choose?"), "pricing page must explain plan fit instead of only listing prices");
  assert.ok(!page.includes('monthlyBase: "1500"'), "pricing page must not hard-code catalog prices");
  assert.ok(!page.includes('perEmployee: "50"'), "pricing page must not hard-code per-employee prices");
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


test("role sandbox uses six real identities and provisions checker and bookkeeper handoffs", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  const roles = read("src/lib/demo-roles.ts");
  const access = read("src/lib/access.ts");
  const dashboard = read("src/lib/dashboard-data.ts");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(route.includes("for (const role of DEMO_ROLE_IDS)"), "opening any persona must provision the complete six-role handoff");
  assert.ok(route.includes('membershipRole: "checker"'), "checker must be a real organization role");
  assert.ok(route.includes('membershipRole: "bookkeeper"'), "bookkeeper must be a real organization role");
  assert.ok(access.includes('"checker"] as const'), "checker must be present in payroll review permissions");
  assert.ok(dashboard.includes('access.role === "checker"'), "checker dashboard must be scoped to assigned approvals");
  assert.ok(roles.includes('"Payroll Officer"') && roles.includes('"HR Admin"') && roles.includes('"Checker"') && roles.includes('"Bookkeeper"'), "public persona labels must match the sandbox");
  assert.ok(workspace.includes("DemoSandboxBar"), "workspace must show the task-driven persona sandbox after launch");
  assert.ok(workspace.includes("onSwitchRole={demoRole ?"), "persona switching must only appear in demo sessions");
});

test("HR demo keeps the same compact shell when navigating from Today to People", () => {
  const shell = read("src/components/workspace/shell.tsx");
  const css = read("src/app/workspace-theme.css");
  const people = read("src/components/workspace/people.tsx");
  const roles = read("src/lib/workspace-role-ui.ts");

  assert.ok(shell.includes("data-demo-role={displayRole ?? undefined}"), "workspace shell must expose demo state to CSS");
  assert.ok(css.includes(".app-shell[data-demo-role] .sidebar"), "demo module pages must retain the light sidebar shell");
  assert.ok(css.includes(".app-shell[data-demo-role] .topbar"), "demo module pages must retain the compact top bar");
  assert.ok(css.includes(".app-shell[data-demo-role] .demo-sandbox"), "demo tools must not create a second page chrome after navigation");
  assert.ok(roles.includes('hr: ["Overview", "People"]'), "HR primary navigation must stay focused on Today and People with the rest under More");
  assert.ok(!people.includes("HrPayrollReadinessCenter"), "People must not repeat the Today payroll-readiness dashboard");
  assert.ok(people.includes('title="Employees"'), "HR employees must present the employee directory as its own destination");
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
  const css = read("src/components/marketing/claude-home/home.css");
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
  const css = read("src/components/marketing/claude-home/home.css");
  assert.ok(preview.includes("function PeopleDemo"), "People must have a dedicated interactive demo");
  assert.ok(preview.includes("function addEmployee"), "People demo must support adding a local employee");
  assert.ok(preview.includes("Import people"), "People demo must link into migration");
  assert.ok(preview.includes("preview-people-overlay"), "People rows must open an employee detail surface");
  assert.ok(preview.includes("Government IDs"), "employee detail must show payroll-relevant identity state");
  assert.ok(css.includes(".preview-people-shell"), "premium homepage must include the scoped People demo styles");
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


test("homepage product screens hand off to the deeper interactive demo", () => {
  const hero = read("src/components/marketing/product-home-hero.tsx");
  const demo = read("src/components/marketing/claude-home/components/Demo.tsx");
  assert.ok(hero.includes("LinawSimulation"));
  assert.ok(hero.includes('href="/demo"'));
  assert.ok(demo.includes('<ProductSimulation area="payroll"'));
  assert.ok(demo.includes("Interactive payroll workflow"));
});

test("pricing explains who each plan is for instead of dumping internal module names", () => {
  const pricing = read("src/components/marketing/claude-home/components/Pricing.tsx");
  assert.ok(pricing.includes("PLAN_COPY"), "pricing must use buyer-oriented outcomes");
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

  assert.ok(nav.includes("<SiteNav />"), "homepage nav must use shared site navigation");
  assert.ok(footer.includes("<SiteFooter />"), "homepage footer must use shared site footer");
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




test("public signup requests controlled trial access instead of exposing tenant provisioning", () => {
  const signup = read("src/app/signup/page.tsx");
  const form = read("src/components/marketing/access-request-form.tsx");
  assert.ok(signup.includes("Request access to a Linaw trial workspace."), "signup must present the real access model");
  assert.ok(signup.includes("<AccessRequestForm />"), "signup must collect a trial access request");
  assert.ok(!signup.includes("This workspace already has an owner."), "public signup must not expose tenant provisioning as a dead end");
  assert.ok(!signup.includes("SetupWizard"), "public signup must never become the owner bootstrap wizard");
  assert.ok(!signup.includes("needsSetup"), "public signup must not change based on database initialization state");
  assert.ok(form.includes("Request trial access"), "trial access form must have a clear submission CTA");
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


test("homepage hero uses product evidence rather than a generic proof card", () => {
  const hero = read("src/components/marketing/product-home-hero.tsx");
  assert.ok(!hero.includes("PayrollOwl"));
  assert.ok(!hero.includes("payroll-hero-control-card"));
  for (const image of ["payroll", "attendance", "hr", "people", "reports", "employee"]) assert.ok(existsSync('public/marketing/screens/' + image + '.webp'));
});

test("Linaw public navigation uses one product brand without a mascot mark", () => {
  const nav = read("src/components/marketing/site-chrome.tsx");
  assert.ok(nav.includes("<strong>Linaw</strong>"), "public navigation must use Linaw branding");
  assert.ok(nav.includes("LinawMark"), "public navigation should use the approved Linaw leaf mark");
  assert.ok(!nav.includes("PayrollOwl"), "public navigation must not use mascot branding");
  assert.ok(!nav.includes("payroll-owl"), "public navigation must not import mascot assets");
});
