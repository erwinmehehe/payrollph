import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { OFFICIAL_PUBLIC_DEMO_HOST, publicDemoHostAllowed } from "../src/lib/demo-host";

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

test("every sandbox persona has a landing page and realistic tasks", () => {
  const roles = read("src/lib/demo-roles.ts");
  for (const landing of ['landingPage: "Overview"', 'landingPage: "People"', 'landingPage: "Payroll"', 'landingPage: "Approvals"', 'landingPage: "My pay"']) {
    assert.ok(roles.includes(landing), `missing ${landing}`);
  }
  for (const task of ["owner-release", "hr-leave", "payroll-submit", "checker-decide", "employee-punch"]) {
    assert.ok(roles.includes(task), `missing sandbox task ${task}`);
  }
});

test("demo switch provisions all personas into one populated sample workspace", () => {
  const route = read("src/app/api/auth/demo-switch/route.ts");
  assert.ok(route.includes("for (const role of DEMO_ROLE_IDS)"), "all personas must be provisioned together");
  assert.ok(route.includes('organizations.name, "Loom & Local"'), "sandbox must use the populated sample company");
  assert.ok(route.includes("createSession"), "persona launch must create a real authenticated session");
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
});

test("arbitrary customer and self-hosted domains cannot provision the public demo tenant", () => {
  assert.equal(publicDemoHostAllowed("customer.example.com"), false);
  assert.equal(publicDemoHostAllowed("localhost"), false);
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
