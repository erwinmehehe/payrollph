import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const route = readFileSync("src/app/api/leave/conversion/route.ts", "utf8");
const runner = readFileSync("scripts/qa/tenant-leave-conversion-post-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-leave-conversion-post-http.yml", "utf8");
test("Leave conversion POST requires own tenant/worker, MFA, caps and same-TX balance reservation", () => {
  const post = route.split("export async function POST")[1];
  for (const k of [
    "enforceSameOriginMutation(request)", "assertOrganizationRole(",
    "requireSensitiveActionMfa(user)",
    "eq(employees.organizationId, organizationId)",
    "approvedLeaveConversionCap(organizationId, leaveType)",
    "leaveConversionTaxReviewAcknowledged(organizationId)",
    "db.transaction(async (tx) =>",
    'eq(leaveBalances.organizationId, organizationId)',
    '.for("update")',
    "tx.insert(leaveConversions)", "tx.insert(auditEvents)",
  ]) assert.ok(post.includes(k), "Missing conversion guard: " + k);
});
test("Exact-tenant CI caps are derived from seeded IDs, not wildcard production flags", () => {
  for (const token of [
    '"seed", "verify"', "caps[e.org.id] = { \"vacation leave\": 5 }",
    "LEAVE_CONVERSION_TAX_REVIEWED_ORG_IDS",
    "process.env.GITHUB_ENV",
    "owned === 3 && denied === 6",
    "employeeId: victim.worker.id",
    "assert.deepEqual(await snapshot(e), before.get(e.org.id)",
    "methodCredits: 0",
  ]) assert.ok(runner.includes(token), "Missing exact-tenant safeguard: " + token);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-leave-conversion-post-http\.mjs seed/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-leave-conversion-post-http\.mjs verify/);
});
