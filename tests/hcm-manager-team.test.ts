import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  managerTeamPositiveId,
  managerTeamBusinessDate,
  projectManagerTeamPage,
  type ManagerTeamSourceRow,
} from "../src/lib/hcm-manager-team";

const sample = (assignmentId: number): ManagerTeamSourceRow => ({
  assignmentId,
  employeeId: assignmentId + 100,
  employeeNo: "SYN-" + assignmentId,
  firstName: "Synthetic",
  lastName: "Worker " + assignmentId,
  employeeStatus: "Active",
  positionCode: "ROLE-" + assignmentId,
  positionStatus: "filled",
  unitName: "Test unit",
  assignmentFrom: "2026-10-01",
  assignmentUntil: null,
});

test("manager-team cursor strictly validates IDs", () => {
  assert.equal(managerTeamPositiveId("100"), 100);
  for (const value of [null, undefined, "", "0", "-1", "+1", "1.0", "1e3", " 1", "01x", "Infinity", "9007199254740993"]) {
    assert.equal(managerTeamPositiveId(value), null);
  }
});

test("manager team defaults to Manila current date not local browser UTC", () => {
  assert.equal(managerTeamBusinessDate(new Date("2026-10-09T15:59:59Z")), "2026-10-09");
  assert.equal(managerTeamBusinessDate(new Date("2026-10-09T16:00:00Z")), "2026-10-10");
});

test("page is bounded and cursor comes from last returned assignment", () => {
  const rows = Array.from({ length: 21 }, (_, i) => sample(30 - i));
  const result = projectManagerTeamPage(rows, {
    organizationId: 3, managerEmployeeId: 12, businessDate: "2026-10-10",
  });
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].assignmentId, 30);
  assert.equal(result.items.at(-1)?.assignmentId, 11);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, 11);
  assert.equal(result.scope, "verified_current_direct_reports");
  assert.equal(result.completeness, "page_only_unverified_relationships_excluded");
  const last = projectManagerTeamPage([sample(10)], {
    organizationId: 3, managerEmployeeId: 12, businessDate: "2026-10-10",
  });
  assert.equal(last.nextCursor, null);
  assert.equal(last.hasMore, false);
});

test("projection never serializes private or free-text worker attributes", () => {
  const raw = {
    ...sample(5),
    basicRate: "900000.00",
    bankAccount: "PRIVATE_BANK_TOKEN",
    email: "PRIVATE_EMAIL_TOKEN",
    performanceRating: "PRIVATE_PERFORMANCE_TOKEN",
    managerNotes: "PRIVATE_DISCIPLINE_TOKEN",
    governmentId: "PRIVATE_GOV_ID_TOKEN",
  };
  const page = projectManagerTeamPage([raw], {
    organizationId: 4, managerEmployeeId: 11, businessDate: "2026-10-10",
  });
  const envelope = JSON.stringify(page);
  for (const forbidden of [
    "900000.00", "PRIVATE_BANK_TOKEN", "PRIVATE_EMAIL_TOKEN",
    "PRIVATE_PERFORMANCE_TOKEN", "PRIVATE_DISCIPLINE_TOKEN", "PRIVATE_GOV_ID_TOKEN",
  ]) assert.ok(!envelope.includes(forbidden), "leaked private field " + forbidden);
  assert.equal(page.items[0].evidence, "recorded_current_assignment");

  const unresolved = projectManagerTeamPage([{ ...sample(4), positionStatus: "closed" }], {
    organizationId: 4, managerEmployeeId: 11, businessDate: "2026-10-10",
  });
  assert.equal(unresolved.items[0].evidence, "position_status_needs_review");
});

test("ambiguous or unsorted source pages are rejected rather than silently reordered", () => {
  const input = { organizationId: 2, managerEmployeeId: 7, businessDate: "2026-10-10" };
  assert.throws(() => projectManagerTeamPage([sample(1), sample(3)], input), /source evidence is invalid/);
  assert.throws(() => projectManagerTeamPage([sample(3), sample(3)], input), /source evidence is invalid/);
  assert.throws(() => projectManagerTeamPage([sample(3)], { ...input, organizationId: -1 }), /source evidence is invalid/);
});

test("API/page are both feature gated, session checked, read-only, selected-employer scoped", () => {
  const api = readFileSync("src/app/api/hcm/my-team/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/my-team/page.tsx", "utf8");
  const loader = readFileSync("src/lib/hcm-manager-team-server.ts", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

  assert.match(api, /HCM_MANAGER_TEAM_ENABLED !== "true"/);
  assert.match(page, /HCM_MANAGER_TEAM_ENABLED !== "true"/);
  assert.match(api, /getSessionUser\(\)/);
  assert.match(page, /getSessionUser\(\)/);
  assert.match(api, /authorizeManagerTeam\(user\.id, organizationId\)/);
  assert.match(page, /authorizeManagerTeam\(user\.id, organizationId\)/);
  assert.match(api, /private, no-store/);
  assert.ok(!api.includes("export async function POST"));
  assert.ok(!api.includes("export async function PATCH"));
  assert.ok(!page.includes("primaryCompanyOrganizationId("));
  assert.match(workspace, /NEXT_PUBLIC_HCM_MANAGER_TEAM_ENABLED === "true"/);
  assert.match(workspace, /data\.selectedOrganization\.id/);
  assert.match(loader, /WORKFORCE_MANAGER_ROLES/);
  assert.match(loader, /access\.role !== "manager"/);
  assert.match(loader, /workerEmployeeId: userOrganizations\.workerEmployeeId/);
  assert.match(loader, /eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(loader, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(loader, /eq\(positions\.organizationId, scope\.organizationId\)/);
  assert.match(loader, /eq\(positionAssignments\.organizationId, scope\.organizationId\)/);
  assert.match(loader, /not exists/);
  assert.match(loader, /other_assignment\.employee_id/);
  assert.match(loader, /MANAGER_TEAM_PAGE_SIZE \+ 1/);
  assert.match(loader, /lt\(positionAssignments\.id, cursor\)/);
  for (const forbidden of ["basicRate:", "bankAccount:", "tin:", "email:", "performanceRating:", "payslip", "salary:"]) {
    assert.ok(!loader.includes(forbidden), "source loader must not fetch " + forbidden);
  }
});
