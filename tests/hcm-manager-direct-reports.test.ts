import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalManagerTeamId, managerDirectReportsBusinessDate,
  managerDirectReportsEnabledForEmployer, managerDirectReportsUnitId,
  MANAGER_DIRECT_REPORTS_PAGE_SIZE,
} from "../src/lib/hcm-manager-direct-reports";

test("direct reports require exact server ON plus exact employer allowlist", () => {
  const on = { HCM_MANAGER_TEAM_ENABLED: "true", HCM_MANAGER_TEAM_ORG_IDS: "14, 15" };
  assert.equal(managerDirectReportsEnabledForEmployer(14, on), true);
  assert.equal(managerDirectReportsEnabledForEmployer(15, on), true);
  for (const org of [0, -1, 13, 16, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(managerDirectReportsEnabledForEmployer(org, on), false);
  }
  for (const flags of [
    {}, { ...on, HCM_MANAGER_TEAM_ENABLED: "false" },
    { ...on, HCM_MANAGER_TEAM_ORG_IDS: "014, 15" },
    { ...on, HCM_MANAGER_TEAM_ORG_IDS: "" },
  ]) assert.equal(managerDirectReportsEnabledForEmployer(14, flags), false);
  assert.equal(canonicalManagerTeamId("14"), 14);
  assert.equal(canonicalManagerTeamId("0", true), 0);
  for (const invalid of [null, "", "0", "014", "-2", "1e4", " 14", "14.0", "9007199254740993"]) {
    assert.equal(canonicalManagerTeamId(invalid), null);
  }
});

test("direct reports accept only an exact-unit manager role, not HR or inferred company scope", () => {
  assert.equal(managerDirectReportsUnitId({
    role: "manager", companyWide: false, orgUnitId: 14,
  }), 14);
  for (const value of [
    null,
    { role: "manager", companyWide: true, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: -1 },
    { role: "owner", companyWide: false, orgUnitId: 14 },
    { role: "hr", companyWide: false, orgUnitId: 14 },
    { role: "payroll", companyWide: false, orgUnitId: 14 },
    { role: "checker", companyWide: false, orgUnitId: 14 },
    { role: "employee", companyWide: false, orgUnitId: 14 },
  ]) assert.equal(managerDirectReportsUnitId(value), null);
});

test("date selection uses PH calendar, not host UTC", () => {
  assert.equal(managerDirectReportsBusinessDate(new Date("2026-10-24T16:30:00Z")), "2026-10-25");
  assert.equal(managerDirectReportsBusinessDate(new Date("2026-10-24T15:30:00Z")), "2026-10-24");
  assert.equal(MANAGER_DIRECT_REPORTS_PAGE_SIZE, 20);
});

test("manager loader does not infer identity, scope or direct reports from unit membership", () => {
  const source = readFileSync("src/lib/hcm-manager-direct-reports-server.ts", "utf8");
  assert.match(source, /assertOrganizationRole\(/);
  assert.match(source, /WORKFORCE_MANAGER_ROLES/);
  assert.match(source, /managerDirectReportsUnitId\(access\)/);
  assert.match(source, /eq\(userOrganizations\.workerEmployeeId|userOrganizations\.workerEmployeeId/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(source, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(source, /eq\(employees\.orgUnitId, scopeUnitId\)/);
  assert.match(source, /inArray\(employees\.status, \["Active", "On leave"\]\)/);
  assert.match(source, /lte\(employees\.startDate, today\)/);
  assert.match(source, /eq\(positions\.organizationId, organizationId\)/);
  assert.match(source, /eq\(positions\.managerEmployeeId, managerEmployeeId\)/);
  assert.match(source, /eq\(positionAssignments\.organizationId, organizationId\)/);
  assert.match(source, /eq\(positionAssignments\.assignmentType, "primary"\)/);
  assert.match(source, /exactlyOneCurrentPrimary/);
  assert.match(source, /current_primary\.employee_id = \$\{employees\.id\}/);
  assert.match(source, /gt\(positionAssignments\.id, cursor\)/);
  assert.match(source, /\.limit\(MANAGER_DIRECT_REPORTS_PAGE_SIZE \+ 1\)/);
  assert.match(source, /\.orderBy\(asc\(positionAssignments\.id\)\)/);
  assert.ok(!source.includes("users.employeeId"));
  assert.ok(!source.includes("db.select().from"));
  for (const sensitive of [
    "basicRate", "bankAccount", "salary", "tin:", "sssNo", "pagIbigNo",
    "reason:", "decisionNote:", "db.update(", "db.insert(", "db.delete(",
  ]) assert.ok(!source.includes(sensitive), "Unexpected sensitive source: " + sensitive);
});

test("page, API and workspace preserve selected employer and have no mutation authority", () => {
  const api = readFileSync("src/app/api/hcm/manager-direct-reports/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/manager-direct-reports/page.tsx", "utf8");
  const app = readFileSync("src/app/app/page.tsx", "utf8");
  for (const s of [api, page]) {
    assert.match(s, /getSessionUser\(\)/);
    assert.match(s, /managerDirectReportsEnabledForEmployer\(organizationId\)/);
    assert.match(s, /loadManagerDirectReports\(/);
    assert.ok(!s.includes("export async function POST"));
    assert.ok(!s.includes("export async function PATCH"));
  }
  assert.match(api, /private, no-store/);
  assert.match(api, /ManagerDirectReportsAccessError/);
  assert.match(page, /Back to first page/);
  assert.match(page, /Next verified records/);
  assert.match(page, /Shared department membership alone does not establish a reporting relationship/);
  assert.match(app, /NEXT_PUBLIC_HCM_MANAGER_TEAM_ENABLED === "true"/);
  assert.match(app, /access\?\.role === "manager"/);
  assert.match(app, /managerDirectReportsEnabledForEmployer\(companyOrganizationId\)/);
  assert.ok(app.includes('"/hcm/manager-direct-reports?organizationId=" + data.selectedOrganization.id'));
  assert.ok(app.includes("Assigned unit directory"));
});
