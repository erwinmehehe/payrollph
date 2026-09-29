import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { OFFICIAL_PUBLIC_DEMO_HOST, publicDemoHostAllowed } from "../src/lib/demo-host";
import { DEMO_ROLE_PAGES } from "../src/lib/demo-roles";

const read = (path: string) => readFileSync(path, "utf8");

test("demo page metadata advertises only the current five personas", () => {
  const page = read("src/app/demo/page.tsx");
  for (const role of ["Owner", "HR Admin", "Payroll Officer", "Checker", "Employee"]) {
    assert.ok(page.includes(role), `demo metadata must mention ${role}`);
  }
  for (const removed of ["bookkeeper", "manager", "freelancer"]) {
    assert.ok(!page.toLowerCase().includes(removed), `demo metadata must not advertise legacy role ${removed}`);
  }
});

test("role sandbox exposes exactly the five product personas", () => {
  const roles = read("src/lib/demo-roles.ts");
  for (const role of ["owner", "hr", "payroll", "checker", "employee"]) {
    assert.ok(roles.includes(`"${role}"`), `missing demo role ${role}`);
  }
  assert.ok(!roles.includes('"bookkeeper"'), "bookkeeper should not replace one of the five sandbox personas");
  assert.ok(!roles.includes('"manager"'), "manager should not replace one of the five sandbox personas");
});

test("company sandbox personas land on role-specific dashboards before opening tasks", () => {
  const roles = read("src/lib/demo-roles.ts");
  const overviewLandings = (roles.match(/landingPage: "Overview"/g) ?? []).length;
  assert.equal(overviewLandings, 4, "owner, HR, payroll and checker should all land on Overview");
  assert.ok(roles.includes('landingPage: "My pay"'), "employee must still land in self-service");
  for (const task of ["owner-release", "hr-leave", "payroll-submit", "checker-decide", "employee-punch"]) {
    assert.ok(roles.includes(task), `missing sandbox task ${task}`);
  }
});

test("hr and payroll demos expose the broader workspaces their server roles support", () => {
  const payrollPages = DEMO_ROLE_PAGES.payroll ?? [];
  const hrPages = DEMO_ROLE_PAGES.hr ?? [];

  for (const page of ["Loans", "Benefits", "De minimis", "Expenses"]) {
    assert.ok(payrollPages.includes(page), `payroll demo should expose ${page}`);
  }

  for (const page of ["Overview", "Loans", "De minimis", "Compliance", "Audit trail"]) {
    assert.ok(hrPages.includes(page), `HR demo should expose ${page}`);
  }

  assert.ok(!payrollPages.includes("Leave"), "payroll demo must not imply leave-administration access");
  assert.ok(!payrollPages.includes("Migration"), "payroll demo must not imply migration-admin access");
  assert.ok(!hrPages.includes("Payroll"), "HR demo must not imply payroll-operator access");
  assert.ok(!hrPages.includes("Migration"), "HR demo must not imply migration-admin access");
});

test("expanded payroll-input demo pages match the existing server authorization model", () => {
  const access = read("src/lib/access.ts");
  const benefits = read("src/app/api/benefits/route.ts");
  const loans = read("src/app/api/loans/route.ts");
  const deMinimis = read("src/app/api/de-minimis/route.ts");
  const expenses = read("src/app/api/expenses/route.ts");
  const migrations = read("src/app/api/migrations/route.ts");
  const leave = read("src/app/api/leave/route.ts");

  assert.ok(
    access.includes('PEOPLE_PAYROLL_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll"]'),
    "HR and payroll must remain inside the shared payroll-input role set",
  );
  for (const [name, route] of [
    ["benefits", benefits],
    ["loans", loans],
    ["de minimis", deMinimis],
    ["expenses", expenses],
  ] as const) {
    assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"), `${name} must use the shared payroll-input server gate`);
  }

  assert.ok(migrations.includes("ORG_ADMIN_ROLES"), "migration must remain an organization-admin-only workflow");
  assert.ok(!leave.includes('"payroll"'), "leave administration must not be widened to payroll");
});

test("role sandbox explains that navigation changes by persona", () => {
  const bar = read("src/components/demo-sandbox-bar.tsx");
  assert.ok(bar.includes("THIS ROLE CAN SEE"), "sandbox must label the current role scope");
  assert.ok(bar.includes("Navigation is scoped to the selected persona"), "sandbox must explain why the nav changes");
  assert.ok(bar.includes("every write action is still checked by the server"), "sandbox must preserve authorization expectations");
});

test("demo switch provisions all personas into one populated sample workspace", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  assert.ok(route.includes("for (const role of DEMO_ROLE_IDS)"), "all personas must be provisioned together");
  assert.ok(route.includes('organizations.name, "Loom & Local"'), "sandbox must use the populated sample company");
  assert.ok(route.includes("createSession"), "persona launch must create a real authenticated session");
});

test("workspace renders distinct owner, HR, payroll and checker dashboards", () => {
  const workspace = read("src/components/linaw-workspace.tsx");
  const dashboard = read("src/components/workspace/role-overview.tsx");

  assert.ok(workspace.includes("normalizeDashboardRole"), "workspace must normalize the real/demo role");
  assert.ok(workspace.includes("<RoleOverviewView"), "workspace must render the role-specific overview");
  for (const marker of [
    'data-role-dashboard={role}',
    "Company control center",
    "People operations today",
    "Cutoff control center",
    "Independent review queue",
  ]) {
    assert.ok(dashboard.includes(marker), `role dashboard missing ${marker}`);
  }
});

test("role dashboards use workspace data rather than hardcoded KPI totals", () => {
  const dashboard = read("src/components/workspace/role-overview.tsx");
  for (const source of [
    "data.employees.filter",
    "data.tasks.filter",
    "data.leaveRequests",
    "data.provisioning",
    "data.payrollEntries.filter",
    "data.retroAdjustments",
    "data.punches",
    "data.advisories.filter",
  ]) {
    assert.ok(dashboard.includes(source), `role dashboard must derive its state from ${source}`);
  }
});

test("workspace and employee self-service share the same persona sandbox control", () => {
  const workspace = read("src/components/linaw-workspace.tsx");
  const selfService = read("src/components/self-service-portal.tsx");
  assert.ok(workspace.includes("DemoSandboxBar"), "company workspace must expose persona tasks and switching");
  assert.ok(selfService.includes("DemoSandboxBar"), "employee self-service must expose the same persona sandbox");
  assert.ok(workspace.includes("availablePages.includes(targetPage)"), "sandbox tasks may only navigate to pages permitted for that persona");
});

test("maker and checker remain separate in the real authorization model", () => {
  const access = read("src/lib/access.ts");
  assert.ok(access.includes('PAYROLL_OPERATOR_ROLES = ["owner", "admin", "bookkeeper", "payroll"]'));
  assert.ok(access.includes('PAYROLL_CHECKER_ROLES = ["owner", "admin", "manager", "checker"]'));
  assert.ok(!access.includes('PAYROLL_CHECKER_ROLES = ["owner", "admin", "manager", "checker", "payroll"]'));
});


test("official public Vercel hostname can launch the sandbox without enabling demo mode globally", () => {
  assert.equal(OFFICIAL_PUBLIC_DEMO_HOST, "erwinmehehe-payrollph.vercel.app");
  assert.equal(publicDemoHostAllowed("erwinmehehe-payrollph.vercel.app"), true);
  assert.equal(publicDemoHostAllowed("ERWINMEHEHE-PAYROLLPH.VERCEL.APP"), true);
  assert.equal(publicDemoHostAllowed("payrollph-three.vercel.app"), true);
  assert.equal(
    publicDemoHostAllowed("payrollph-git-homepage-preview.vercel.app", {
      deploymentHost: "payrollph-git-homepage-preview.vercel.app",
    }),
    true,
  );
});

test("arbitrary customer and self-hosted domains cannot provision the public demo tenant", () => {
  assert.equal(publicDemoHostAllowed("customer.example.com"), false);
  assert.equal(publicDemoHostAllowed("localhost"), false);
  assert.equal(
    publicDemoHostAllowed("other-preview.vercel.app", {
      deploymentHost: "this-preview.vercel.app",
    }),
    false,
  );
  assert.equal(
    publicDemoHostAllowed("preview.example.com", { configuredHosts: "preview.example.com" }),
    true,
  );
});

test("production demo switch provisions only the isolated public demo tenant when demo mode is off", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  const publicDemo = read("src/db/public-demo.ts");
  assert.ok(route.includes("ensurePublicDemoTenant"), "production demo path must provision the isolated public demo tenant");
  assert.ok(route.includes("publicDemoHostAllowed"), "production demo path must be host-gated");
  assert.ok(publicDemo.includes("pg_advisory_xact_lock"), "first-launch provisioning must be concurrency-safe");
  assert.ok(publicDemo.includes('const PUBLIC_DEMO_ORG = "Loom & Local"'), "public demo must stay in the dedicated tenant");
  assert.ok(!publicDemo.includes("Mantra Studio"), "public production demo must not seed unrelated demo organizations");
  assert.ok(!publicDemo.includes("Santos Retail Group"), "public production demo must not seed unrelated demo organizations");
});


test("optional public demo enrichment cannot block the core sandbox", () => {
  const publicDemo = read("src/db/public-demo.ts");
  assert.ok(publicDemo.includes("async function optionalSeed"), "optional demo data must be isolated behind a non-blocking helper");
  for (const enrichment of ['optionalSeed("subscription"', 'optionalSeed("attendance"', 'optionalSeed("leave"', 'optionalSeed("audit"']) {
    assert.ok(publicDemo.includes(enrichment), `missing resilient enrichment: ${enrichment}`);
  }
  assert.ok(publicDemo.indexOf("return organization.id") < publicDemo.indexOf("await ensureOptionalDemoData(organizationId)"),
    "core demo tenant must commit before optional enrichment runs");
});

test("demo switch returns a controlled response when provisioning fails", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  assert.ok(route.includes('console.error("Public demo provisioning failed"'), "server must log provisioning failures");
  assert.ok(route.includes("The demo workspace could not be prepared. Please try again in a moment."), "browser must receive a useful retry message");
  assert.ok(route.includes("{ status: 503 }"), "provisioning failures must be service-unavailable, not an empty 500");
});


test("public demo provisioning retries transient failures without exposing diagnostics", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  assert.ok(route.includes("async function preparePublicDemoTenant()"), "public demo must use a retryable provisioning wrapper");
  assert.ok(route.includes("attempt <= 3"), "public demo provisioning must retry transient failures");
  assert.ok(route.includes("await preparePublicDemoTenant()"), "production demo launch must use the retry wrapper");
  assert.ok(!route.includes("safeProvisioningDiagnostic"), "temporary production diagnostics must be removed");
  assert.ok(!route.includes("diagnostic:"), "demo launch responses must not expose schema diagnostics");
});
