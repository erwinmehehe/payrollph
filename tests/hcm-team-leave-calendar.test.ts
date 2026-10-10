import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeLeaveRequestSpans,
  currentPhilippineMonth,
  deriveTeamLeaveScope,
  isPermittedTeamLeaveMonth,
  monthShift,
  summarizeTeamLeaveMonth,
  teamLeaveMonthCells,
  teamLeaveMonthWindow,
  type TeamLeaveCase,
} from "../src/lib/hcm-team-leave-calendar-contract";

test("manager calendar fails closed without explicit active unit membership", () => {
  assert.equal(deriveTeamLeaveScope(null), null);
  for (const access of [
    { role: "manager", companyWide: true, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: 0 },
    { role: "manager", companyWide: false, orgUnitId: -3 },
    { role: "bookkeeper", companyWide: true, orgUnitId: null },
    { role: "checker", companyWide: false, orgUnitId: 8 },
    { role: "employee", companyWide: false, orgUnitId: 8 },
  ]) assert.equal(deriveTeamLeaveScope(access), null, access.role + " unexpectedly permitted");
  assert.deepEqual(deriveTeamLeaveScope({
    role: "manager", companyWide: false, orgUnitId: 8,
  }), { kind: "unit", orgUnitId: 8 });
  assert.deepEqual(deriveTeamLeaveScope({
    role: "hr", companyWide: true, orgUnitId: null,
  }), { kind: "company", orgUnitId: null });
  assert.deepEqual(deriveTeamLeaveScope({
    role: "owner", companyWide: false, orgUnitId: 6,
  }), { kind: "unit", orgUnitId: 6 });
});

test("Philippine calendar month is independent of UTC and browser local time", () => {
  const beforeManilaMidnight = new Date("2026-09-30T15:59:00Z");
  const afterManilaMidnight = new Date("2026-09-30T16:01:00Z");
  assert.equal(currentPhilippineMonth(beforeManilaMidnight), "2026-09");
  assert.equal(currentPhilippineMonth(afterManilaMidnight), "2026-10");
  assert.equal(isPermittedTeamLeaveMonth("2026-09", afterManilaMidnight), false);
  assert.equal(isPermittedTeamLeaveMonth("2026-10", afterManilaMidnight), true);
  assert.equal(isPermittedTeamLeaveMonth("2027-04", afterManilaMidnight), true);
  assert.equal(isPermittedTeamLeaveMonth("2027-05", afterManilaMidnight), false);
  assert.equal(isPermittedTeamLeaveMonth("2026-13", afterManilaMidnight), false);
  assert.equal(isPermittedTeamLeaveMonth("2026-0", afterManilaMidnight), false);
  assert.equal(monthShift("2026-12", 1), "2027-01");
  assert.equal(monthShift("2027-01", -1), "2026-12");
  assert.throws(() => monthShift("2026-00", 1));
});

test("month grid is Monday first and keeps leap-day evidence exact", () => {
  assert.deepEqual(teamLeaveMonthWindow("2028-02"), {
    start: "2028-02-01", end: "2028-02-29",
  });
  const february = teamLeaveMonthCells("2028-02");
  assert.equal(february.length, 42);
  assert.equal(february.filter(Boolean).length, 29);
  assert.equal(february[0], null); // February 1 2028 is Tuesday.
  assert.equal(february[1], "2028-02-01");
  assert.ok(february.includes("2028-02-29"));
  assert.ok(!february.includes("2028-03-01"));
  assert.deepEqual(teamLeaveMonthWindow("2026-10"), {
    start: "2026-10-01", end: "2026-10-31",
  });
});

test("source request date spans overlap days but do not assert full-day absence", () => {
  const rows: TeamLeaveCase[] = [
    {
      requestId: 1, employeeId: 4, employeeNo: "A4", employeeName: "Sample Person",
      status: "Approved", startDate: "2026-09-30", endDate: "2026-10-02",
    },
    {
      requestId: 2, employeeId: 9, employeeNo: "A9", employeeName: "Sample Two",
      status: "Pending", startDate: "2026-10-02", endDate: "2026-10-05",
    },
  ];
  assert.deepEqual(activeLeaveRequestSpans("2026-10-01", rows).map((row) => row.requestId), [1]);
  assert.deepEqual(activeLeaveRequestSpans("2026-10-02", rows).map((row) => row.requestId), [1, 2]);
  assert.deepEqual(activeLeaveRequestSpans("2026-10-06", rows), []);
  assert.deepEqual(summarizeTeamLeaveMonth(rows), {
    approvedRequestRecords: 1, pendingRequestRecords: 1,
  });
});

test("calendar route and page enforce source gate, explicit tenant and private no-store", () => {
  const api = readFileSync("src/app/api/hcm/team-leave-calendar/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/team-leave-calendar/page.tsx", "utf8");
  for (const source of [api, page]) {
    assert.match(source, /HCM_TEAM_LEAVE_CALENDAR_ENABLED !== "true"/);
    assert.match(source, /getSessionUser/);
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /WORKFORCE_MANAGER_ROLES/);
    assert.match(source, /deriveTeamLeaveScope/);
    assert.ok(!source.includes("primaryCompanyOrganizationId"));
  }
  assert.match(api, /getAccess\(user\.id, organizationId\)/);
  assert.match(api, /private, no-store/);
  assert.match(api, /TeamLeaveSourceOverflowError/);
  assert.match(page, /key=\{organizationId\}/);
  assert.ok(!api.includes("export async function POST"));
  assert.ok(!api.includes("export async function PATCH"));
});

test("calendar SQL filters request AND employee tenant before bounded complete snapshot", () => {
  const server = readFileSync("src/lib/hcm-team-leave-calendar-server.ts", "utf8");
  assert.match(server, /eq\(leaveRequests\.organizationId, organizationId\)/);
  assert.match(server, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(server, /eq\(employees\.orgUnitId, scope\.orgUnitId\)/);
  assert.match(server, /eq\(orgUnits\.organizationId, organizationId\)/);
  assert.match(server, /eq\(orgUnits\.active, true\)/);
  assert.match(server, /inArray\(leaveRequests\.status, \["Approved", "Pending"\]\)/);
  assert.match(server, /lte\(leaveRequests\.startDate, dates\.end\)/);
  assert.match(server, /gte\(leaveRequests\.endDate, dates\.start\)/);
  assert.match(server, /\.limit\(TEAM_LEAVE_SOURCE_CEILING \+ 1\)/);
  assert.match(server, /if \(rows\.length > TEAM_LEAVE_SOURCE_CEILING\)/);
  for (const field of ["leaveRequests.leaveType", "leaveRequests.reason", "leaveRequests.days",
    "leaveRequests.decidedBy", "employees.basicRate", "employees.bankAccount",
    "employees.tin", "employees.mobile", "employees.birthDate"]) {
    assert.ok(!server.includes(field), "Sensitive source selected: " + field);
  }
  assert.ok(!server.includes("db.update("));
  assert.ok(!server.includes("db.insert("));
  assert.ok(!server.includes("db.delete("));
});

test("client hides stale tenant/month responses and shows only recorded request statuses", () => {
  const ui = readFileSync("src/components/hcm-team-leave-calendar.tsx", "utf8");
  const nav = readFileSync("src/components/workspace/approvals.tsx", "utf8");
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /result\.organizationId !== organizationId/);
  assert.match(ui, /result\.month !== month/);
  assert.match(ui, /loaded\?\.requestKey === requestKey/);
  assert.match(nav, /NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED === "true"/);
  assert.match(nav, /data\.selectedOrganization\.id/);
  for (const word of ["method: \"POST\"", "method: \"PATCH\"", "bankAccount", "leaveType"]) {
    assert.ok(!ui.includes(word), "Unexpected client source field or mutation: " + word);
  }
});
