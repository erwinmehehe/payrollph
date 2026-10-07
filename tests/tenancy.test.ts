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

test("every session route calls a shared tenant or role gate", () => {
  const missing = SESSION_ROUTES.filter((path) => {
    const source = read(path);
    return !source.includes("assertMembership") && !source.includes("assertOrganizationRole");
  });
  assert.deepEqual(missing, [], `routes without tenant isolation: ${missing.join(", ")}`);
});

test("no session route trusts a client-supplied organizationId alone", () => {
  // Both membership and role gates must receive the authenticated user's id.
  for (const path of SESSION_ROUTES) {
    const source = read(path);
    assert.ok(
      /assert(?:Membership|OrganizationRole)\(\s*\w+\.id,/.test(source),
      `${path} must pass the session user id to the gate`,
    );
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

test("payroll authority separates preparation, approval, release and live disbursement", () => {
  const access = read("src/lib/access.ts");
  assert.ok(access.includes('PAYROLL_OPERATOR_ROLES = ["owner", "admin", "bookkeeper", "payroll"]'));
  assert.ok(access.includes('PAYROLL_CHECKER_ROLES = ["owner", "admin", "manager", "checker"]'));
  assert.ok(access.includes('PAYROLL_RELEASE_ROLES = ["owner", "admin"]'));
  assert.ok(access.includes('PAYROLL_DISBURSEMENT_ROLES = ["owner"]'));

  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");
  assert.ok(release.includes("PAYROLL_RELEASE_ROLES"));

  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  assert.ok(exportsRoute.includes("authorizeTreasuryOperation"));
  assert.ok(exportsRoute.includes('if (mode === "preflight")'));
  assert.ok(exportsRoute.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(exportsRoute.includes("requireReleaseSeparation: true"));
});

test("payroll creation validates real dates and caps a cutoff at 16 days", () => {
  const source = read("src/app/api/payroll-runs/route.ts");
  assert.ok(source.includes("validIsoDate"));
  assert.ok(source.includes("MAX_PAYROLL_PERIOD_DAYS = 16"));
  assert.ok(source.includes("inclusivePeriodDays"));
});

test("payslip exports are bound to the exact payroll run, not only its period label", () => {
  const source = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  assert.ok(source.includes("innerJoin(payrollEntries"));
  assert.ok(source.includes("eq(payrollEntries.payrollRunId, run.id)"));
  assert.ok(!source.includes("rows.filter((row) => row.periodLabel === run.periodLabel)"));
});


test("asset assignment cannot cross organization boundaries", () => {
  const source = read("src/app/api/assets/route.ts");
  assert.ok(source.includes("employees.organizationId"), "asset employee lookup must be constrained by organization");
  assert.ok(source.includes("Employee not found in this organization."));
  assert.ok(source.includes("and(eq(employees.id, candidate), eq(employees.organizationId, organizationId))"));
  assert.ok(source.includes("and(eq(employees.id, candidate), eq(employees.organizationId, target.organizationId))"));
});


test("employee payslip downloads require a released run in the employee's own organization", () => {
  const detail = read("src/app/api/self/payslips/[id]/route.ts");
  const list = read("src/app/api/self/payslips/route.ts");
  assert.ok(detail.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(detail.includes("eq(payrollRuns.organizationId, employee.organizationId)"));
  assert.ok(detail.includes("eq(payrollEntries.employeeId, session.employeeId)"));
  assert.ok(list.includes("eq(payrollRuns.organizationId, employee.organizationId)"));
});

test("membership org units are resolved only inside the same organization", () => {
  const access = read("src/lib/access.ts");
  assert.ok(access.includes("eq(orgUnits.organizationId, organizationId)"));
});


test("unit-scoped roles cannot read or export company-wide employee and payroll data", () => {
  const employees = read("src/app/api/employees/route.ts");
  assert.ok(employees.includes("getAccess(user.id, organizationId)"));
  assert.ok(employees.includes("rows.filter((employee) => employee.orgUnitId === access.orgUnitId)"));
  assert.ok(employees.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(employees.includes("orgUnitId: employeeOrgUnitId"));

  const reports = read("src/app/api/reports/route.ts");
  assert.ok(reports.includes("if (!access?.companyWide)"));
  assert.ok(reports.includes("Company-wide analytics are not available to unit-scoped roles."));

  const exportsRoute = read("src/app/api/exports/route.ts");
  assert.ok(exportsRoute.includes('kind !== "employees" && !access.companyWide'));
  assert.ok(exportsRoute.includes("allEmployeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId)"));
});


test("employee-linked HR modules enforce org-unit boundaries", () => {
  const expectations = [
    ["src/app/api/documents/route.ts", "assertScope", "visibleDocuments"],
    ["src/app/api/assets/route.ts", "assertScope", "visibleIds"],
    ["src/app/api/benefits/route.ts", "assertScope", "visibleStaff"],
    ["src/app/api/discipline/route.ts", "assertScope", "access.orgUnitId"],
    ["src/app/api/provisioning/route.ts", "assertScope", "visibleStaff"],
    ["src/app/api/expenses/route.ts", "assertScope", "visibleEmployeeIds"],
  ] as const;

  for (const [path, scopeMarker, visibilityMarker] of expectations) {
    const source = read(path);
    assert.ok(source.includes("getAccess("), `${path} must resolve the caller's unit scope`);
    assert.ok(source.includes(scopeMarker), `${path} must enforce employee scope on mutations`);
    assert.ok(source.includes(visibilityMarker), `${path} must constrain list visibility`);
  }
});


test("payroll run lifecycle cannot cross organization-unit boundaries", () => {
  const runRoute = read("src/app/api/payroll-runs/route.ts");
  assert.ok(runRoute.includes("assertOrganizationUnitAccess"));
  assert.ok(runRoute.includes("getAccess(sessionUser.id, organizationId)"));
  assert.ok(runRoute.includes("eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!)"));
  assert.ok(runRoute.includes("effectiveScopeOrgUnitId = access.companyWide ? rawScopeOrgUnitId : access.orgUnitId"));

  for (const path of [
    "src/app/api/payroll-runs/[id]/process/route.ts",
    "src/app/api/payroll-runs/[id]/submit-review/route.ts",
    "src/app/api/payroll-runs/[id]/assurance/route.ts",
    "src/app/api/payroll-runs/[id]/release-checklist/route.ts",
    "src/app/api/payroll-runs/[id]/explain/[employeeId]/route.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
    "src/app/api/payroll-runs/[id]/exports/route.ts",
  ]) {
    const source = read(path);
    assert.ok(
      source.includes("assertOrganizationUnitAccess"),
      `${path} must enforce the payroll run's organization-unit scope`,
    );
    assert.ok(
      source.includes("run.scopeOrgUnitId"),
      `${path} must use the stored payroll run scope, not a caller-supplied unit`,
    );
  }
});


test("employee money and final-pay workflows enforce organization-unit scope", () => {
  for (const path of [
    "src/app/api/loans/route.ts",
    "src/app/api/earned-wage/route.ts",
    "src/app/api/de-minimis/route.ts",
    "src/app/api/separation/route.ts",
  "src/app/api/separation/[id]/2316/route.ts",
  ]) {
    const source = read(path);
    assert.ok(source.includes("getAccess("), `${path} must resolve organization-unit access`);
    assert.ok(source.includes("assertScope"), `${path} must reject out-of-unit employee mutations`);
  }

  const separation = read("src/app/api/separation/route.ts");
  assert.ok(separation.includes("requireSensitiveActionMfa"));
  assert.ok(separation.includes('action === "approve" || action === "release"'));
});


test("tenant-wide security and billing controls require company-wide administrator access", () => {
  for (const path of [
    "src/app/api/developer/route.ts",
    "src/app/api/billing/route.ts",
    "src/app/api/organizations/route.ts",
  ]) {
    const source = read(path);
    assert.ok(source.includes("getAccess("), `${path} must resolve membership scope`);
    assert.ok(source.includes("companyWide"), `${path} must reject unit-scoped administrators`);
  }
});


test("tenant-wide imports privacy and recruitment reject unit-scoped administrators", () => {
  for (const path of [
    "src/app/api/employees/import/route.ts",
    "src/app/api/migrations/route.ts",
    "src/app/api/compliance/data-requests/route.ts",
    "src/app/api/recruitment/route.ts",
  ]) {
    const source = read(path);
    assert.ok(source.includes("getAccess("), `${path} must resolve membership scope`);
    assert.ok(source.includes("companyWide"), `${path} must reject unit-scoped administrators`);
  }
});

test("dashboard and approval discovery do not expose cross-unit payroll data", () => {
  const dashboard = read("src/lib/dashboard-data.ts");
  assert.ok(dashboard.includes("eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!)"));
  assert.ok(dashboard.includes("const canViewAudit = access.companyWide"));
  assert.ok(dashboard.includes("delegation.fromApprover.toLowerCase() === sessionUser.name.toLowerCase()"));

  const approvers = read("src/app/api/organizations/[id]/payroll-approvers/route.ts");
  assert.ok(approvers.includes("row.orgUnitId === access.orgUnitId"));

  const delegations = read("src/app/api/delegations/route.ts");
  assert.ok(delegations.includes("access?.companyWide && roleAllowed"));
  assert.ok(delegations.includes("member.orgUnitId === access?.orgUnitId"));
});
