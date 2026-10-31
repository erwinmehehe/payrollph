import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/leave/route.ts", "utf8");
const post = source.split("export async function POST")[1];

test("Leave POST picker excludes inactive/revoked members and disabled accounts", () => {
  assert.match(post, /\.where\(and\(\s*eq\(userOrganizations.organizationId, organizationId\),\s*eq\(userOrganizations.active, true\),\s*eq\(users.active, true\),/);
  assert.ok(post.includes("member.id !== user.id"));
  assert.ok(post.includes("roleAllowed(member.role, LEAVE_APPROVER_ROLES)"));
});

test("Leave POST rechecks checker membership in same transaction before creating task", () => {
  const transaction = post.slice(post.indexOf("const created = await db.transaction"));
  for (const token of [
    "const [liveApprover] = await tx.select({ id: users.id })",
    "eq(userOrganizations.organizationId, organizationId)",
    "eq(userOrganizations.userId, approver.id)",
    "eq(userOrganizations.active, true)",
    "eq(users.active, true)",
    "inArray(userOrganizations.role, [...LEAVE_APPROVER_ROLES])",
    'throw new Error("LEAVE_APPROVER_CHANGED")',
    "await tx.insert(approvalTasks)", "await tx.insert(leaveRequests)",
    "await tx.insert(auditEvents)",
  ]) assert.ok(transaction.includes(token), "Missing final leave checker boundary: " + token);
  assert.ok(transaction.indexOf("const [liveApprover]") < transaction.indexOf("await tx.insert(approvalTasks)"));
});

test("Revoked checker cannot cause orphan approvals; fail closed as 409", () => {
  assert.ok(post.includes('error.message === "LEAVE_APPROVER_CHANGED"'));
  assert.ok(post.includes('if (created === "approver_changed")'));
  assert.ok(post.includes('code: "LEAVE_APPROVER_CHANGED"'));
  assert.ok(post.includes("status: 409"));
});
