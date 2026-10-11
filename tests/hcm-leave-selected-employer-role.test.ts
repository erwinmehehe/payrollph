import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/leave/route.ts", "utf8");

test("mixed-role employer sessions use selected employer membership for all leave branches", () => {
  const segments = [
    route.slice(route.indexOf("export async function GET("),
      route.indexOf("export async function POST(")),
    route.slice(route.indexOf("export async function POST(")),
  ];
  for (const section of segments) {
    assert.ok(section.includes("const access = await getAccess(user.id, organizationId)"));
    assert.ok(section.includes("const deniedMembership = await assertMembership(user.id, organizationId)"));
    assert.ok(!section.includes('user.role === "employee"'));
    assert.ok(!section.includes('user.role !== "employee"'));
  }
  // Includes the early employee-profile validation before schema initialization.
  assert.equal((route.match(/access\.role === "employee"/g) ?? []).length, 4);
  assert.ok((route.match(/access\.role !== "employee"/g) ?? []).length >= 4);
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("eq(leaveRequests.organizationId, organizationId)"));
  assert.ok(route.includes('deriveMyTeamScope(access)?.kind !== "unit"'));
  assert.ok(route.includes("freshWorker.orgUnitId !== access.orgUnitId"));
  assert.ok(route.includes("freshEmployee.orgUnitId !== access.orgUnitId"));
  assert.ok(route.includes("LEAVE_SCOPE_CHANGED"));
});

test("employee membership remains self-service only; manager membership does not inherit global login employee role", () => {
  const get = route.slice(route.indexOf("export async function GET("),
    route.indexOf("export async function POST("));
  const post = route.slice(route.indexOf("export async function POST("));
  assert.match(get, /if \(access\.role === "employee"\)\s*\{/);
  assert.match(get, /scopeConditions\.push\(eq\(leaveRequests\.employeeId, user\.employeeId\)\)/);
  assert.match(get, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /if \(access\.role === "employee"\)/);
  assert.match(post, /user\.employeeId !== leave\.employeeId/);
  assert.match(post, /employeeId = user\.employeeId/);
  assert.match(post, /!access\.companyWide && employee\.orgUnitId !== access\.orgUnitId/);
});
