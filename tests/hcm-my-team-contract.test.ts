import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveMyTeamScope, summarizeMyTeamPage,
} from "../src/lib/hcm-my-team-contract";

test("a manager needs a concrete, scoped organizational unit", () => {
  assert.deepEqual(
    deriveMyTeamScope({ role: "manager", companyWide: false, orgUnitId: 31 }),
    { kind: "unit", orgUnitId: 31 },
  );
  for (const access of [
    { role: "manager", companyWide: true, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: -1 },
    { role: "manager", companyWide: false, orgUnitId: 1.5 },
    { role: "bookkeeper", companyWide: true, orgUnitId: null },
    { role: "payroll", companyWide: false, orgUnitId: 31 },
    { role: "employee", companyWide: false, orgUnitId: 31 },
  ]) {
    assert.equal(deriveMyTeamScope(access), null, "Unexpected team scope: " + access.role);
  }
  assert.equal(deriveMyTeamScope(null), null);
});

test("HR and owners have only explicit current membership scope", () => {
  assert.deepEqual(
    deriveMyTeamScope({ role: "hr", companyWide: true, orgUnitId: null }),
    { kind: "company", orgUnitId: null },
  );
  assert.deepEqual(
    deriveMyTeamScope({ role: "admin", companyWide: false, orgUnitId: 17 }),
    { kind: "unit", orgUnitId: 17 },
  );
  assert.deepEqual(
    deriveMyTeamScope({ role: "owner", companyWide: true, orgUnitId: null }),
    { kind: "company", orgUnitId: null },
  );
});

test("manager home counts are bounded to displayed page not global workforce", () => {
  assert.deepEqual(summarizeMyTeamPage([
    { pendingLeaveRecords: 2, pendingOvertimeRecords: 3 },
    { pendingLeaveRecords: 0, pendingOvertimeRecords: 1 },
  ]), {
    employeeRecordsThisPage: 2,
    pendingLeaveRecordsThisPage: 2,
    pendingOvertimeRecordsThisPage: 4,
  });
});

test("API and page fail closed unless explicitly enabled and authorized", () => {
  const api = readFileSync("src/app/api/hcm/my-team/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/my-team/page.tsx", "utf8");
  for (const source of [api, page]) {
    assert.match(source, /HCM_MY_TEAM_ENABLED !== "true"/);
    assert.match(source, /getSessionUser/);
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /WORKFORCE_MANAGER_ROLES/);
    assert.match(source, /deriveMyTeamScope/);
    assert.ok(!source.includes("primaryCompanyOrganizationId"));
  }
  assert.match(api, /getAccess\(user\.id, organizationId\)/);
  assert.match(api, /Number\.isSafeInteger/);
  assert.match(api, /private, no-store/);
  assert.ok(!api.includes("export async function POST"));
  assert.ok(!api.includes("export async function PATCH"));
});

test("all SQL reads use explicit tenant and narrowly scoped team employee IDs", () => {
  const source = readFileSync("src/lib/hcm-my-team-server.ts", "utf8");
  assert.match(source, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(source, /eq\(employees\.orgUnitId, scope\.orgUnitId\)/);
  assert.match(source, /eq\(orgUnits\.organizationId, organizationId\)/);
  assert.match(source, /eq\(orgUnits\.active, true\)/);
  assert.match(source, /eq\(leaveRequests\.organizationId, organizationId\)/);
  assert.match(source, /eq\(overtimeRequests\.organizationId, organizationId\)/);
  assert.match(source, /inArray\(leaveRequests\.employeeId, employeeIds\)/);
  assert.match(source, /inArray\(overtimeRequests\.employeeId, employeeIds\)/);
  assert.match(source, /gt\(employees\.id, cursor\)/);
  assert.ok(source.includes("concat_ws"), "full-name search must happen before pagination");
  assert.match(source, /\.limit\(PAGE_SIZE \+ 1\)/);
  assert.match(source, /groupBy\(leaveRequests\.employeeId\)/);
  assert.match(source, /groupBy\(overtimeRequests\.employeeId\)/);
  for (const field of ["basicRate", "bankAccount", "tin:", "sssNo", "philHealthNo", "pagIbigNo", "reason:", "decisionNote:"]) {
    assert.ok(!source.includes(field), "Unexpected sensitive column: " + field);
  }
  assert.ok(!source.includes("db.select().from"));
  assert.ok(!source.includes("db.update("));
  assert.ok(!source.includes("db.insert("));
  assert.ok(!source.includes("db.delete("));
});

test("workspace UI has a gated link and stale employer/page responses cannot surface", () => {
  const app = readFileSync("src/app/app/page.tsx", "utf8");
  const ui = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  assert.match(app, /NEXT_PUBLIC_HCM_MY_TEAM_ENABLED === "true"/);
  assert.match(app, /data\.selectedOrganization\.id/);
  assert.ok(app.includes('access.role === "manager" && !access.companyWide && access.orgUnitId !== null'));
  const page = readFileSync("src/app/hcm/my-team/page.tsx", "utf8");
  assert.ok(page.includes("<HcmMyTeamClient key={organizationId} organizationId={organizationId} />"), "employer switch must reset cursors and filters");
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /data\.organizationId !== organizationId/);
  assert.match(ui, /stored\?\.scopeKey === scopeKey/);
  assert.match(ui, /data\.page\.nextCursor/);
  assert.match(ui, /setCursors\(\[0\]\)/);
  assert.ok(!ui.includes('method: "POST"'));
  assert.ok(!ui.includes('method: "PATCH"'));
  assert.ok(!ui.includes("bankAccount"));
});
