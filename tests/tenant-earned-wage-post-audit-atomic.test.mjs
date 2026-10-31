import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/earned-wage/route.ts", "utf8");
const post = route.split("export async function POST")[1].split("export async function PATCH")[0];

test("EWA POST request + organization audit commit atomically", () => {
  assert.ok(post.includes("const row = await db.transaction(async (tx) => {"));
  assert.ok(post.includes("const [created] = await tx.insert(earnedWageRequests)"));
  assert.ok(post.includes("await recordAuditEvent({"));
  assert.ok(post.includes("}, tx);"));
  assert.ok(post.indexOf("const row = await db.transaction(") <
    post.indexOf("await recordAuditEvent({"));
  assert.ok(post.indexOf("await recordAuditEvent({") < post.indexOf("}, tx);"));
  assert.ok(!post.includes("const [row] = await db.insert(earnedWageRequests)"));
});

test("POST continues to enforce signed-in employer/employee membership before inserts", () => {
  for (const token of [
    "enforceSameOriginMutation(request)",
    "getSessionUser()",
    "assertMembership(user.id, organizationId)",
    "assertOrganizationRole(",
    "eq(employees.id, employeeId)",
    "eq(employees.organizationId, organizationId)",
    "assertScope(adminAccess, employee.orgUnitId)",
    "if (!check.eligible)",
  ]) assert.ok(post.includes(token), "Missing EWA POST guard: " + token);
});
