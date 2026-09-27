import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const SESSION_ROUTES = [
  "src/app/api/dashboard/route.ts",
  "src/app/api/exports/route.ts",
  "src/app/api/reports/route.ts",
  "src/app/api/year-end/route.ts",
  "src/app/api/developer/route.ts",
  "src/app/api/provisioning/route.ts",
  "src/app/api/leave/route.ts",
  "src/app/api/delegations/route.ts",
  "src/app/api/documents/route.ts",
  "src/app/api/invitations/route.ts",
  "src/app/api/payroll-runs/route.ts",
  "src/app/api/payroll-runs/[id]/process/route.ts",
  "src/app/api/payroll-runs/[id]/release/route.ts",
  "src/app/api/approvals/[id]/route.ts",
  "src/app/api/compliance/data-requests/route.ts",
  "src/app/api/payroll-runs/[id]/exports/route.ts",
  "src/app/api/employees/import/route.ts",
];

// Handlers that are safe without the gate because they are scoped to the
// session itself (own user, own employee record) or carry no organization scope.
const SELF_SCOPED = [
  "src/app/api/self/payslips/route.ts",
  "src/app/api/self/payslips/[id]/route.ts",
  "src/app/api/auth/me/route.ts",
  "src/app/api/employees/import/template/route.ts",
];

test("resource-addressed job status is checked against the run's organization", () => {
  const source = read("src/app/api/payroll-runs/route.ts");
  const getBody = source.split("export async function GET")[1] ?? "";
  assert.ok(getBody.includes("deniedJob"), "runId job-status branch must be gated");
  assert.ok(getBody.includes("deniedRuns"), "run listing branch must be gated");
});

test("self-scoped routes never accept an organizationId parameter", () => {
  for (const path of SELF_SCOPED) {
    const source = read(path);
    assert.ok(!/body\.organizationId/.test(source), `${path} must not read an organizationId from the body`);
  }
});

test("every session route calls the shared membership gate", () => {
  const missing = SESSION_ROUTES.filter((path) => !read(path).includes("assertMembership"));
  assert.deepEqual(missing, [], `routes without tenant isolation: ${missing.join(", ")}`);
});

test("no session route trusts a client-supplied organizationId alone", () => {
  // The gate must compare against the session user's id, not accept the id as-is.
  for (const path of SESSION_ROUTES) {
    const source = read(path);
    assert.ok(/assertMembership\(\w+\.id,/.test(source), `${path} must pass the session user id to the gate`);
  }
});

test("the self-service link ignores the request body's organizationId", () => {
  const source = read("src/app/api/self/payslips/route.ts");
  assert.ok(source.includes("userOrganizations"), "linking must resolve the caller's own organizations");
  assert.ok(!/Number\(body\.organizationId/.test(source), "organizationId must not be read from the request body");
  assert.ok(source.includes("inArray(employees.organizationId, myOrganizations)"), "employee lookup must be constrained to the caller's workspaces");
});

test("the gate returns 403 rather than leaking existence", () => {
  const access = read("src/lib/access.ts");
  assert.ok(access.includes('status: 403'));
  assert.ok(access.includes("You do not have access to this workspace."));
});

test("the CSV template is served as CSV, not as JSON", () => {
  const route = read("src/app/api/employees/import/template/route.ts");
  assert.ok(route.includes("text/csv"), "template endpoint must return CSV");
  assert.ok(route.includes("TEMPLATE_CSV"));
  // The main import route returns JSON, so the UI must not link to it for downloads.
  const ui = read("src/components/import-panel.tsx");
  assert.ok(ui.includes("/api/employees/import/template"));
  assert.ok(!ui.includes('href="/api/employees/import?organizationId='), "template button must not point at the JSON endpoint");
});
