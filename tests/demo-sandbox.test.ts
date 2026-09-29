import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

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
