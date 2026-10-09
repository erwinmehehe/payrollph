import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { OFFICIAL_PUBLIC_DEMO_HOST, publicDemoHostAllowed, publicDemoRequestAllowed } from "../src/lib/demo-host";
import { DEMO_ROLE_PAGES } from "../src/lib/demo-roles";
import {
  REAL_ROLE_PAGE_ACCESS,
  ROLE_PRIMARY_PAGES,
  roleCanDecideApprovals,
  roleCanManageDelegations,
  roleCanManagePayroll,
  roleCanManagePeople,
  roleCanManageTime,
} from "../src/lib/workspace-role-ui";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("demo page metadata advertises all six product personas", () => {
  const page = read("src/app/demo/page.tsx");
  for (const role of ["Owner", "HR Admin", "Payroll Officer", "Checker", "Bookkeeper", "Employee"]) {
    assert.ok(page.includes(role), `demo metadata must mention ${role}`);
  }
  for (const removed of ["manager", "freelancer"]) {
    assert.ok(!page.toLowerCase().includes(removed), `demo metadata must not advertise legacy role ${removed}`);
  }
});

test("role sandbox exposes exactly the six product personas", () => {
  const roles = read("src/lib/demo-roles.ts");
  for (const role of ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"]) {
    assert.ok(roles.includes(`"${role}"`), `missing demo role ${role}`);
  }
  assert.ok(!roles.includes('"manager"'), "manager should not replace one of the five sandbox personas");
});

test("company sandbox personas land on role-specific dashboards before opening tasks", () => {
  const roles = read("src/lib/demo-roles.ts");
  const overviewLandings = (roles.match(/landingPage: "Overview"/g) ?? []).length;
  assert.equal(overviewLandings, 5, "owner, HR, payroll, checker and bookkeeper should all land on Overview");
  assert.ok(roles.includes('landingPage: "My pay"'), "employee must still land in self-service");
  for (const task of ["owner-release", "hr-leave", "payroll-submit", "checker-decide", "bookkeeper-close", "employee-punch"]) {
    assert.ok(roles.includes(task), `missing sandbox task ${task}`);
  }
});

test("hr and payroll demos expose the broader workspaces their server roles support", () => {
  const payrollPages = DEMO_ROLE_PAGES.payroll ?? [];
  const hrPages = DEMO_ROLE_PAGES.hr ?? [];

  for (const page of ["Loans", "Benefits", "De minimis", "Expenses"]) {
    assert.ok(payrollPages.includes(page), `payroll demo should expose ${page}`);
  }

  for (const page of ["Overview", "Workforce", "Loans", "De minimis", "Compliance"]) {
    assert.ok(hrPages.includes(page), `HR demo should expose ${page}`);
  }

  assert.ok(!payrollPages.includes("Leave"), "payroll demo must not imply leave-administration access");
  assert.ok(!payrollPages.includes("Migration"), "payroll demo must not imply migration-admin access");
  assert.ok(!hrPages.includes("Payroll"), "HR demo must not imply payroll-operator access");
  assert.ok(!hrPages.includes("Migration"), "HR demo must not imply migration-admin access");
  assert.ok(!hrPages.includes("Audit trail"), "HR demo must not expose audit data the dashboard server withholds");
});

test("real HR, payroll and checker navigation is role-scoped too", () => {
  for (const role of ["hr", "payroll", "checker"] as const) {
    assert.deepEqual(
      REAL_ROLE_PAGE_ACCESS[role],
      DEMO_ROLE_PAGES[role],
      `real ${role} navigation should match the proven demo scope`,
    );
  }

  assert.ok(!REAL_ROLE_PAGE_ACCESS.hr?.includes("Payroll"), "real HR must not be shown payroll-operator navigation");
  assert.ok(!REAL_ROLE_PAGE_ACCESS.payroll?.includes("Leave"), "real payroll must not be shown leave-admin navigation");
  assert.ok(!REAL_ROLE_PAGE_ACCESS.checker?.includes("People"), "real checker must stay out of people administration");
  assert.ok(!REAL_ROLE_PAGE_ACCESS.checker?.includes("Payroll"), "checker payroll review remains in approvals until the payroll page supports a safe read-only mode");
});

test("real workspace action controls follow server role families", () => {
  assert.equal(roleCanManagePayroll("payroll"), true);
  assert.equal(roleCanManagePayroll("checker"), false);
  assert.equal(roleCanManagePayroll("hr"), false);

  assert.equal(roleCanManagePeople("hr"), true);
  assert.equal(roleCanManagePeople("payroll"), false);
  assert.equal(roleCanManageTime("hr"), true);
  assert.equal(roleCanManageTime("payroll"), false);

  assert.equal(roleCanDecideApprovals("checker"), true);
  assert.equal(roleCanDecideApprovals("hr"), true);
  assert.equal(roleCanDecideApprovals("payroll"), false);

  assert.equal(roleCanManageDelegations("checker"), true);
  assert.equal(roleCanManageDelegations("hr"), false);
  assert.equal(roleCanManageDelegations("payroll"), false);
});

test("payroll approvals render as review-only instead of exposing forbidden decision controls", () => {
  const approvals = read("src/components/workspace/approvals.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(approvals.includes("canDecide"), "approvals view needs an explicit decision capability");
  assert.ok(approvals.includes("canManageDelegations"), "delegation controls need a separate capability");
  assert.ok(approvals.includes('task.status === "Pending" && canDecide'), "pending decision buttons must be capability-gated");
  assert.ok(workspace.includes("roleCanDecideApprovals(effectiveRole)"), "workspace must derive approval controls from the real role");
  assert.ok(workspace.includes("workspacePagesForRole(effectiveRole)"), "real user navigation must be role-scoped");
});

test("dashboard payload withholds approval delegation rows from HR and payroll", () => {
  const dashboard = read("src/lib/dashboard-data.ts");
  assert.ok(dashboard.includes("PAYROLL_CHECKER_ROLES"), "dashboard must reuse the checker role family for delegation visibility");
  assert.ok(dashboard.includes("const canViewDelegations = roleAllowed(access.role, PAYROLL_CHECKER_ROLES)"));
  assert.ok(
    dashboard.includes("canViewDelegations\n      ? db.select().from(approvalDelegations)"),
    "delegation rows must be conditionally queried",
  );
});

test("HR receives only an amount-free payroll handoff summary", () => {
  const dashboard = read("src/lib/dashboard-data.ts");
  const roleOverview = read("src/components/workspace/role-overview.tsx");

  assert.ok(
    dashboard.includes('access.role === "hr" && access.companyWide'),
    "safe payroll summary must be restricted to company-wide HR",
  );
  assert.ok(dashboard.includes("payrollHandoffRun: handoffRun"), "dashboard must expose the handoff summary");
  assert.ok(roleOverview.includes("return data.payrollHandoffRun ?? fallback;"), "HR dashboard must use the safe summary fallback");

  const selectStart = dashboard.indexOf(".select({\n            id: payrollRuns.id");
  const selectEnd = dashboard.indexOf("})\n          .from(payrollRuns)", selectStart);
  assert.ok(selectStart > -1 && selectEnd > selectStart, "safe handoff select must exist");
  const safeSelect = dashboard.slice(selectStart, selectEnd);
  for (const privateField of ["grossPay", "netPay", "exceptions", "employeeCount"]) {
    assert.ok(!safeSelect.includes(privateField), `safe HR handoff must not select ${privateField}`);
  }
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
    ["de minimis", deMinimis],
    ["expenses", expenses],
  ] as const) {
    assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"), `${name} must use the shared payroll-input server gate`);
  }

  // Loan deductions are more sensitive than ordinary payroll inputs: their
  // activation now requires an independent payroll/tax checker, company-wide
  // access and a separate release gate, not the general HR input roles.
  assert.ok(loans.includes("PAYROLL_OPERATOR_ROLES"), "loan makers need payroll operator authority");
  assert.ok(loans.includes("PAYROLL_TAX_APPROVER_ROLES"), "loan activation needs a distinct payroll reviewer");
  assert.ok(loans.includes("!access?.companyWide"), "loan mutations must be company-wide only");

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
  const dashboard = read("src/components/workspace/role-overview-v2.tsx");

  assert.ok(workspace.includes("normalizeDashboardRole"), "workspace must normalize the real/demo role");
  assert.ok(workspace.includes("<RoleOverviewView"), "workspace must render the role-specific overview");
  assert.ok(dashboard.includes("<ContractGreeting firstName={firstName}"), "role dashboards must keep the persona greeting contract");
  for (const role of ["owner", "hr", "payroll", "checker"]) {
    assert.ok(dashboard.includes(`data-dashboard-variant="${role}"`), `role dashboard missing ${role} composition`);
  }
});

test("role dashboards use workspace data rather than hardcoded KPI totals", () => {
  const dashboard = read("src/components/workspace/role-overview-v2.tsx");
  for (const source of [
    "data.employees.filter",
    "data.leaveRequests",
    "data.provisioning",
    "data.payrollEntries.filter",
    "data.retroAdjustments",
    "data.punches",
  ]) {
    assert.ok(dashboard.includes(source), `role dashboard must derive its state from ${source}`);
  }
});

test("payroll handoff notifications are role-specific and state-derived", () => {
  const shell = read("src/components/workspace/shell.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(shell.includes("buildNotifications(data: DashboardData, role?: string | null)"));
  assert.ok(shell.includes('effectiveRole === "hr"'));
  assert.ok(shell.includes('effectiveRole === "payroll"'));
  assert.ok(shell.includes('effectiveRole === "checker"'));
  assert.ok(shell.includes('effectiveRole === "owner"'));
  assert.ok(shell.includes("Resolve ${run.exceptions} payroll exception"));
  assert.ok(shell.includes("is approved and ready to release"));
  assert.ok(workspace.includes("buildNotifications(data, effectiveRole)"));
});

test("role dashboards expose one direct handoff action without widening permissions", () => {
  const dashboard = read("src/components/workspace/role-overview.tsx");
  assert.ok(dashboard.includes("data-handoff-action={role}"));
  assert.ok(dashboard.includes("Resolve ${payrollExceptions} payroll exception"));
  assert.ok(dashboard.includes("Submit ${run?.periodLabel ?? \"payroll\"} to Checker"));
  assert.ok(dashboard.includes("Review ${run?.periodLabel ?? \"submitted payroll\"}"));
  assert.ok(dashboard.includes("Release ${run?.periodLabel ?? \"approved payroll\"}"));
  assert.ok(dashboard.includes('page: "Approvals"'));
  assert.ok(dashboard.includes('page: "Payroll"'));
});

test("checker and owner dashboards select runs owned by their current lifecycle stage", () => {
  const dashboard = read("src/components/workspace/role-overview.tsx");
  assert.ok(dashboard.includes('role === "checker"'));
  assert.ok(dashboard.includes("payrollHandoffRank(run.status) === 2"));
  assert.ok(dashboard.includes('role === "owner"'));
  assert.ok(dashboard.includes("payrollHandoffRank(run.status) === 3"));
  assert.ok(dashboard.includes('role === "payroll"'));
  assert.ok(dashboard.includes("payrollHandoffRank(run.status) === 1"));
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


test("only explicit public demo hosts can launch the sandbox without enabling demo mode globally", () => {
  assert.equal(OFFICIAL_PUBLIC_DEMO_HOST, "erwinmehehe-payrollph.vercel.app");
  assert.equal(publicDemoHostAllowed("erwinmehehe-payrollph.vercel.app"), true);
  assert.equal(publicDemoHostAllowed("ERWINMEHEHE-PAYROLLPH.VERCEL.APP"), true);
  assert.equal(publicDemoHostAllowed("payrollph-three.vercel.app"), true);
  assert.equal(publicDemoHostAllowed("payrollph-git-homepage-preview.vercel.app"), false);
  assert.equal(
    publicDemoHostAllowed("payrollph-git-homepage-preview.vercel.app", {
      configuredHosts: "payrollph-git-homepage-preview.vercel.app",
    }),
    true,
  );
  assert.equal(
    publicDemoHostAllowed("new-payrollph-production.vercel.app", {
      vercelEnv: "production",
      vercelUrl: "new-payrollph-production.vercel.app",
    }),
    true,
  );
  assert.equal(
    publicDemoHostAllowed("canonical-payrollph.vercel.app", {
      vercelEnv: "production",
      vercelProductionUrl: "https://canonical-payrollph.vercel.app",
    }),
    true,
  );
});

test("canonical APP_BASE_URL can authorize a custom production demo host", () => {
  assert.equal(
    publicDemoHostAllowed("payroll.example.com", {
      appBaseUrl: "https://payroll.example.com",
    }),
    true,
  );

  const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "x-forwarded-host": "payroll.example.com",
    },
  });

  assert.equal(
    publicDemoRequestAllowed(request, {
      appBaseUrl: "https://payroll.example.com",
    }),
    true,
    "the canonical production app host must not need a second PUBLIC_DEMO_HOSTS entry",
  );
});

test("arbitrary customer and self-hosted domains cannot provision the public demo tenant", () => {
  assert.equal(publicDemoHostAllowed("customer.example.com"), false);
  assert.equal(publicDemoHostAllowed("localhost"), false);
  assert.equal(publicDemoHostAllowed("other-preview.vercel.app"), false);
  assert.equal(
    publicDemoHostAllowed("other-preview.vercel.app", {
      vercelEnv: "preview",
      vercelUrl: "other-preview.vercel.app",
      vercelProductionUrl: "canonical-payrollph.vercel.app",
    }),
    false,
  );
  assert.equal(
    publicDemoHostAllowed("customer.example.com", {
      vercelEnv: "production",
      vercelUrl: "production-deployment.vercel.app",
      vercelProductionUrl: "canonical-payrollph.vercel.app",
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
  assert.ok(route.includes("publicDemoRequestAllowed"), "production demo path must honor public/forwarded host gating");
  assert.ok(route.includes("appBaseUrl: process.env.APP_BASE_URL"), "production demo path must trust the configured canonical app host");
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


test("production Vercel aliases are accepted from forwarded host plus deployment metadata", () => {
  const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "x-forwarded-host": "new-payrollph-production.vercel.app",
    },
  });

  assert.equal(
    publicDemoRequestAllowed(request, {
      vercelEnv: "production",
      vercelUrl: "new-payrollph-production.vercel.app",
      vercelProductionUrl: "canonical-payrollph.vercel.app",
    }),
    true,
    "production Vercel aliases must not depend on request.url exposing the public hostname",
  );
});

test("shared public nav uses the approved leaf brand and blue action", () => {
  const chrome = read("src/components/marketing/site-chrome.tsx");
  const css = read("src/components/marketing/public-pages.css");
  assert.ok(chrome.includes("LinawMark"));
  assert.ok(chrome.includes('className="ln-primary"'));
  assert.match(css, /background:\s*#0877f9\s*!important/);
  assert.ok(!chrome.includes('bg-[#11141F]'));
});


test("public demo repairs stale employees before persona provisioning", () => {
  const demo = read("src/db/public-demo.ts");
  const route = read("src/app/api/auth/demo-switch/route.ts");
  assert.ok(demo.includes("Repair older demo tenants in-place"));
  assert.ok(demo.includes("await tx.update(employees).set(values)"));
  assert.ok(demo.includes("email = employeeEmail"));
  assert.ok(route.includes("Launch the requested persona first"));
  assert.ok(route.includes("Secondary demo persona provisioning skipped"));
});


test("Vercel forwarded host can authorize the canonical public sandbox", () => {
  const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "x-forwarded-host": "erwinmehehe-payrollph.vercel.app",
    },
  });

  assert.equal(publicDemoRequestAllowed(request), true);
});

test("forwarded host fallback does not allow arbitrary preview or customer domains", () => {
  const preview = new Request("http://127.0.0.1/api/auth/demo-switch", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "x-forwarded-host": "payrollph-git-random-preview.vercel.app",
    },
  });
  const customer = new Request("http://127.0.0.1/api/auth/demo-switch", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "x-forwarded-host": "customer.example.com",
    },
  });

  assert.equal(publicDemoRequestAllowed(preview), false);
  assert.equal(publicDemoRequestAllowed(customer), false);
});


test("workspace sidebar profile keeps avatar styling separate from the role label", () => {
  const styles = read("src/app/globals.css");
  assert.ok(styles.includes(".side-profile-avatar > .avatar"), "sidebar avatar needs a dedicated size/visual treatment");
  assert.ok(styles.includes(".side-profile-avatar > i"), "sidebar avatar needs a dedicated online-status indicator");
  assert.ok(styles.includes(".side-profile > div:nth-child(2) > span"), "role label styling must target only the profile text");
  assert.ok(!styles.includes(".side-profile span {"), "broad descendant span styling must not override the nested avatar");
});


test("demo sandbox uses dedicated wrapping-safe controls", () => {
  const bar = read("src/components/demo-sandbox-bar.tsx");
  const selfService = read("src/components/self-service-portal.tsx");
  const styles = read("src/app/globals.css");

  assert.ok(bar.includes("demo-persona-badge"), "live persona should not reuse the generic status pill");
  assert.ok(bar.includes("demo-access-chip"), "role access labels need wrapping-safe chips");
  assert.ok(bar.includes("demo-task-card"), "sandbox tasks need dedicated card layout");
  assert.ok(selfService.includes("employee-self-service"), "employee page should use the wider responsive container");
  assert.ok(styles.includes(".demo-task-card.secondary-button"), "task cards need a dedicated button override");
  assert.ok(styles.includes("white-space: normal;"), "sandbox copy must be allowed to wrap");
  assert.ok(styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "desktop sandbox tasks should use a balanced three-column layout");
});


test("sandbox task grid keeps a balanced tablet composition", () => {
  const styles = read("src/app/globals.css");
  assert.ok(
    !styles.includes("@media (max-width: 900px) {\n  .demo-task-grid"),
    "768px tablet should not collapse the three task cards into an awkward 2+1 layout",
  );
  assert.ok(
    styles.includes("@media (max-width: 720px) {\n  .demo-task-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));"),
    "mid-width sandbox should use two task columns",
  );
  assert.ok(
    styles.includes("@media (max-width: 520px)"),
    "mobile breakpoint must remain explicit",
  );
});

test("production demo is isolated from real sensitive-data prerequisites", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  const publicDemo = read("src/db/public-demo.ts");

  assert.ok(route.includes('demoDataMode: "synthetic-redacted"'), "demo responses must declare the redacted data mode");
  assert.ok(route.includes("sensitiveFieldsPersisted: false"), "demo responses must prove that sensitive fields are not persisted");
  assert.ok(!route.includes("BANK_DATA_ENCRYPTION_REQUIRED"), "missing real bank keys must not block the isolated sandbox");
  assert.ok(!route.includes("BANK_DATA_ENCRYPTION_NOT_READY"), "legacy real-data migration state must not block the isolated sandbox");

  assert.ok(publicDemo.includes("bankAccount: null"), "public demo employees and payment snapshots must not persist bank-account values");
  assert.ok(publicDemo.includes("tin: null"), "public demo employees must not persist TIN values");
  assert.ok(publicDemo.includes("sssNo: null"), "public demo employees must not persist SSS values");
  assert.ok(publicDemo.includes("philHealthNo: null"), "public demo employees must not persist PhilHealth values");
  assert.ok(publicDemo.includes("pagIbigNo: null"), "public demo employees must not persist Pag-IBIG values");
  assert.ok(!publicDemo.includes("encryptBankAccount("), "public demo must not need production bank encryption");
  assert.ok(!publicDemo.includes("encryptGovernmentId("), "public demo must not need production PII encryption");
});


test("role dashboards use product status banners without mascot dependencies", () => {
  const dashboard = read("src/components/workspace/role-overview.tsx");
  const alert = read("src/components/workspace/dashboard-alert-banner.tsx");
  const shell = read("src/components/workspace/shell.tsx");
  const styles = read("src/app/workspace-theme.css");

  assert.ok(dashboard.includes("DashboardAlertBanner"), "role dashboards must keep the shared status banner");
  assert.ok(alert.includes("dashboard-alert-symbol"), "attention banner must render a neutral status symbol");
  assert.ok(!alert.includes("PayrollOwl"), "attention banner must not depend on mascot code");
  assert.ok(!shell.includes("PayrollOwlMark"), "workspace brand must not use the owl mark");
  assert.ok(styles.includes(".dashboard-alert-symbol"), "workspace must style the neutral status symbol");
});


test("workspace dashboard matches the PayrollPH mockup using modular real-data components", () => {
  for (const path of [
    "src/components/workspace/dashboard-alert-banner.tsx",
    "src/components/workspace/dashboard-stat-card.tsx",
    "src/components/workspace/recent-payroll-runs.tsx",
  ]) {
    assert.equal(existsSync(path), true, `missing dashboard module: ${path}`);
  }

  const dashboard = read("src/components/workspace/role-overview-v2.tsx");
  const shell = read("src/components/workspace/shell.tsx");
  const alert = read("src/components/workspace/dashboard-alert-banner.tsx");
  const stats = read("src/components/workspace/dashboard-stat-card.tsx");
  const runs = read("src/components/workspace/recent-payroll-runs.tsx");
  const styles = read("src/app/workspace-theme.css");

  assert.ok(shell.includes("PayrollPH"), "workspace brand must match the PayrollPH mockup");
  assert.ok(shell.includes("primaryPages"), "workspace shell must receive a role-specific primary navigation set");
  assert.ok(shell.includes("secondaryItems"), "secondary features must remain reachable outside the primary navigation");
  assert.ok(shell.includes("nav-more-toggle"), "secondary features must be grouped under More instead of deleted");
  assert.deepEqual(ROLE_PRIMARY_PAGES.owner, ["Overview", "Payroll", "Analytics", "People", "Settings"]);
  assert.deepEqual(ROLE_PRIMARY_PAGES.hr, ["Overview", "People"]);
  for (const page of ["Planning", "Compensation", "Workforce", "Time & attendance", "Leave", "Recruitment", "Performance"]) {
    assert.ok(REAL_ROLE_PAGE_ACCESS.hr?.includes(page), `HR secondary page ${page} must remain accessible under More`);
  }
  assert.deepEqual(ROLE_PRIMARY_PAGES.payroll, ["Overview", "Payroll", "Time & attendance", "People"]);
  assert.deepEqual(ROLE_PRIMARY_PAGES.checker, ["Overview", "Audit trail"]);
  assert.deepEqual(ROLE_PRIMARY_PAGES.bookkeeper, ["Overview", "Exports", "Compliance", "Readiness", "Analytics"]);
  assert.ok(shell.includes("Search employees, payroll, reports"), "top search should use the mockup wording");
  assert.ok(dashboard.includes("mockup-owner-release"), "owner dashboard must render the approved release card");
  assert.ok(dashboard.includes("mockup-four-step"), "payroll dashboard must render the approved workflow stepper");
  assert.ok(dashboard.includes("mockup-checker-summary"), "checker dashboard must render the approved comparison summary");
  assert.ok(dashboard.includes("hr-readiness-mockup"), "HR dashboard must render the approved readiness composition");
  assert.ok(dashboard.includes("mockup-close-steps"), "bookkeeper dashboard must render the approved close timeline");
  for (const role of ["owner", "hr", "payroll", "checker", "bookkeeper"]) {
    assert.ok(dashboard.includes(`data-dashboard-variant="${role}"`), `missing role-first dashboard composition for ${role}`);
  }
  assert.ok(alert.includes("items.map"), "alert banner must render state-derived items");
  assert.ok(stats.includes("tone"), "stat cards must expose semantic status tones");
  assert.ok(runs.includes("runs.slice(0, 3)"), "recent payroll history must use real recent run data");
  assert.ok(runs.includes("dashboard-payroll-list"), "recent payroll history should render lightweight operational rows");
  assert.ok(!runs.includes("September 2024"), "recent payroll history must not hardcode screenshot rows");
  assert.ok(styles.includes(".payrollph-dashboard"), "workspace theme must include the dashboard composition");
  assert.ok(styles.includes(".mockup-kpi-four"), "workspace theme must style the payroll KPI strip");
  assert.ok(styles.includes(".mockup-owner-release"), "workspace theme must style the owner release card");
  assert.ok(styles.includes(".mockup-table-row"), "workspace theme must style the mockup operational tables");
  assert.ok(styles.includes('.app-shell[data-workspace-page="Overview"] .demo-sandbox'), "overview must hide the bulky demo sandbox");
  assert.ok(styles.includes('.payrollph-dashboard .role-dashboard-grid'), "legacy detail grid must remain available off the focused landing composition");
});

test("employee self-service keeps the payslip summary without mascot dependencies", () => {
  const selfService = read("src/components/self-service-portal.tsx");
  const employeeHome = read("src/components/employee-home-dashboard.tsx");
  assert.ok(selfService.includes("<EmployeeHomeDashboard"), "employee portal must render its released-pay summary");
  assert.ok(employeeHome.includes("data-latest-payslip"), "employee view must keep the latest-payslip summary card");
  assert.ok(employeeHome.includes("Payslip available"), "released payslip status must stay explicit");
  assert.ok(!selfService.includes("PayrollGuide"), "employee view must not use the mascot guide");
  assert.ok(!selfService.includes("payroll-owl"), "employee view must not import mascot assets");
  assert.ok(!selfService.includes("RecentPayrollRuns"), "employee view must not expose company payroll run history");
});


test("PayrollPH no longer ships the owl mascot component or asset", () => {
  assert.equal(existsSync("src/components/payroll-owl.tsx"), false, "owl component should be removed");
  assert.equal(existsSync("public/mascots/payroll-owl.webp"), false, "owl raster asset should be removed");
});
