import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveMyTeamScope } from "../src/lib/hcm-my-team-contract";

test("unassigned and company-wide manager memberships never imply company-wide staff authority", () => {
  for (const membership of [
    { role: "manager", companyWide: true, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: null },
    { role: "manager", companyWide: false, orgUnitId: -5 },
    { role: "manager", companyWide: false, orgUnitId: 1.5 },
  ]) {
    assert.equal(deriveMyTeamScope(membership), null);
  }
  assert.deepEqual(deriveMyTeamScope({
    role: "manager", companyWide: false, orgUnitId: 29,
  }), { kind: "unit", orgUnitId: 29 });
  assert.deepEqual(deriveMyTeamScope({
    role: "hr", companyWide: true, orgUnitId: null,
  }), { kind: "company", orgUnitId: null });
});

test("shared access resolution never promotes unassigned manager to company-wide role", () => {
  const access = readFileSync("src/lib/access.ts", "utf8");
  assert.ok(access.includes('membership.role === "manager" &&'));
  assert.ok(access.includes('Number.isSafeInteger(membership.orgUnitId)'));
  assert.ok(access.includes('membership.orgUnitId <= 0)) return null;'));
  assert.ok(access.indexOf('membership.role === "manager" &&') <
    access.indexOf('companyWide: membership.orgUnitId == null'));
  assert.ok(access.includes('row.role === "manager" &&'));
  assert.ok(access.includes('row.orgUnitId <= 0'));
  assert.ok(access.includes('An assigned organizational unit is required for manager access.'));
});

test("dashboard requires a valid manager unit before loading any employer records", () => {
  const source = readFileSync("src/lib/dashboard-data.ts", "utf8");
  const accessIndex = source.indexOf("const access = await getAccess(");
  const guardIndex = source.indexOf('access.role === "manager" && deriveMyTeamScope(access)?.kind !== "unit"');
  const salaryIndex = source.indexOf("await ensureEmployeePayProfiles(");
  const employeeIndex = source.indexOf("db.select().from(employees).where(employeeFilter)");
  assert.ok(accessIndex >= 0 && guardIndex > accessIndex && guardIndex < salaryIndex && guardIndex < employeeIndex);
  assert.match(source, /assigned supervisory unit is required to load the manager workspace/);

  const api = readFileSync("src/app/api/dashboard/route.ts", "utf8");
  assert.ok(api.includes('access.role === "manager" && deriveMyTeamScope(access)?.kind !== "unit"'));
  assert.ok(api.includes("status: 403"));
  const page = readFileSync("src/app/app/page.tsx", "utf8");
  assert.ok(page.includes('managerAccess.role === "manager" && deriveMyTeamScope(managerAccess)?.kind !== "unit"'));
  assert.ok(page.includes("if (!managerAccess ||"));
  assert.ok(page.includes("notFound()"));
});

test("leave reads filter all assigned-unit staff and reject missing manager unit", () => {
  const source = readFileSync("src/app/api/leave/route.ts", "utf8");
  const start = source.indexOf("export async function GET(");
  const end = source.indexOf("export async function POST(", start);
  const get = source.slice(start, end);
  assert.ok(get.includes("const deniedMembership = await assertMembership(user.id, organizationId)"));
  const guardIndex = get.indexOf('access.role === "manager" && deriveMyTeamScope(access)?.kind !== "unit"');
  const listIndex = get.indexOf("const rows = await db.select({");
  assert.ok(guardIndex > 0 && guardIndex < listIndex);
  assert.match(get, /else if \(!access\.companyWide && access\.orgUnitId\)/);
  assert.match(get, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(get, /eq\(employees\.orgUnitId, access\.orgUnitId\)/);
  assert.match(get, /rows\.filter\(\(\{ leave \}\) => employeeIds!\.includes\(leave\.employeeId\)\)/);
  assert.ok(get.includes('access.role !== "employee" && !access.companyWide'));
  assert.ok(!get.includes('access.role === "manager" && !access.companyWide && access.orgUnitId'));
});

test("leave submit/revision fail closed on cross-unit employee moves, including transaction races", () => {
  const source = readFileSync("src/app/api/leave/route.ts", "utf8");
  const post = source.slice(source.indexOf("export async function POST("));
  assert.match(post, /assertMembership\(user\.id, organizationId\)/);
  assert.match(post, /deriveMyTeamScope\(access\)\?\.kind !== "unit"/);
  assert.match(post, /user\.role !== "employee" && !access\.companyWide && employee\.orgUnitId !== access\.orgUnitId/);
  assert.match(post, /user\.role !== "employee" && !access\.companyWide &&\s+freshWorker\.orgUnitId !== access\.orgUnitId/);
  assert.match(post, /user\.role !== "employee" && !access\.companyWide &&\s+freshEmployee\.orgUnitId !== access\.orgUnitId/);
  assert.match(post, /throw new Error\("LEAVE_SCOPE_CHANGED"\)/);
  assert.match(post, /return "scope_changed" as const/);
  assert.match(post, /if \(created === "scope_changed"\)/);
  assert.match(post, /status: 409/);
  assert.ok(!post.includes('access.role === "manager" && !access.companyWide && access.orgUnitId && employee.orgUnitId !== access.orgUnitId'));
  assert.match(post, /if \(user\.role === "employee"\)/);
});
