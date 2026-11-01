import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/earned-wage/route.ts", "utf8");
const post = route.split("export async function POST")[1].split("export async function PATCH")[0];

test("EWA POST request + organization audit commit atomically", () => {
  assert.ok(post.includes("const result = await db.transaction(async (tx) => {"));
  assert.ok(post.includes("const [created] = await tx.insert(earnedWageRequests)"));
  assert.ok(post.includes("await recordAuditEvent({"));
  assert.ok(post.includes("}, tx);"));
  assert.ok(post.indexOf("const result = await db.transaction(") <
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

test("EWA POST locks the tenant employee before rechecking pending advances", () => {
  const lock = post.indexOf('.for("update")');
  const pending = post.indexOf("const existing = await tx.select().from(earnedWageRequests)");
  const insert = post.indexOf("const [created] = await tx.insert(earnedWageRequests)");
  assert.ok(lock > 0 && pending > lock && insert > pending,
    "Eligibility must be rechecked after the per-employee write lock and before insertion");
  for (const token of [
    "eq(earnedWageRequests.organizationId, organizationId)",
    "eq(earnedWageRequests.employeeId, employeeId)",
    'hasPendingRequest: existing.some((row) => row.status === "pending")',
    "status: employee.status",
    "if (!check.eligible)",
    "}).catch(() => null)",
    'if (result.kind === "ineligible")',
  ]) assert.ok(post.includes(token), "Missing serialized EWA POST boundary: " + token);
});

test("EWA POST counts only punches bound to the requested employer and employee", () => {
  const punches = post.slice(post.indexOf("const punches ="), post.indexOf("const daysWorked ="));
  assert.ok(punches.includes("eq(timePunches.organizationId, organizationId)"));
  assert.ok(punches.includes("eq(timePunches.employeeId, employeeId)"));
  assert.ok(punches.includes("gte(timePunches.workDate, periodStart())"));
});
