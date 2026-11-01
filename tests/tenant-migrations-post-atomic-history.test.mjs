import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/migrations/route.ts", "utf8");
const post = route.split("export async function POST")[1];

test("Migration POST rejects unauthorized users before compatibility schema writers", () => {
  assert.ok(post.indexOf("const user = await getSessionUser()") <
    post.indexOf("await ensureCoreCompatibilitySchema()"));
  assert.ok(post.indexOf("const denied = await assertOrganizationRole(") <
    post.indexOf("await ensureCoreCompatibilitySchema()"));
  assert.ok(post.indexOf("const mfaDenied = requireSensitiveActionMfa(user)") <
    post.indexOf("await ensureCoreCompatibilitySchema()"));
});

test("Historical import batch, rows and audit are one organization-scoped transaction", () => {
  const history = post.split("const batch = await db.transaction(async (tx) => {")[1];
  assert.ok(history);
  for (const token of [
    "tx.insert(importBatches)",
    "tx.insert(historicalPayrollEntries)",
    "tx.insert(leaveBalances)",
    "tx.select().from(employeeLoans)",
    "tx.update(employeeLoans)",
    "tx.insert(employeeLoans)",
    "await recordAuditEvent({",
    "}, tx);",
  ]) assert.ok(history.includes(token), "Missing atomic legacy import: " + token);
  assert.ok(!history.includes("await db.insert("));
  assert.ok(!history.includes("await db.update("));
});

test("Historical money/leave updates cannot adopt foreign employee IDs", () => {
  const history = post.split("const batch = await db.transaction(async (tx) => {")[1];
  for (const token of [
    "setWhere: eq(leaveBalances.organizationId, organizationId)",
    'if (!savedBalance) throw new Error("MIGRATION_BALANCE_SCOPE_CHANGED")',
    "eq(employeeLoans.id, existingLoan.id)",
    "eq(employeeLoans.organizationId, organizationId)",
    "eq(employeeLoans.employeeId, employee.id)",
    'if (!updatedLoan) throw new Error("MIGRATION_LOAN_SCOPE_CHANGED")',
    'code: "MIGRATION_SOURCE_SCOPE_CHANGED"',
  ]) assert.ok(history.includes(token), "Missing final migration tenant guard: " + token);
});
