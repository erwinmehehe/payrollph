/**
 * Source-level defense in depth. Real own/victim HTTP+PG16 proof and independent
 * security review are still required before changing tenant coverage claims.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/employee-identifier-requests/route.ts", "utf8");
const approval = route.split('if (action === "approve") {')[1]?.split("    const [decision] = await tx.update(essIdentifierRequests)")[0];
const decision = route.split("    const [decision] = await tx.update(essIdentifierRequests)")[1]?.split("    return {")[0];

test("all five core identifier writes repeat the authorized employer and employee keys", () => {
  assert.ok(approval, "approval handler must exist");
  for (const key of ["sssNo", "tin", "tinBranchCode", "philHealthNo", "pagIbigNo"]) {
    assert.ok(approval.includes('row.kind === "' + key + '" ? { ' + key + ': row.proposedEncrypted }'),
      key + " must update the same reviewed value");
  }
  assert.match(approval, /tx\.update\(employees\)\.set\(employeePatch\)\.where\(and\(\s*eq\(employees\.id, row\.employeeId\),\s*eq\(employees\.organizationId, organizationId\),?\s*\)\)/s);
  assert.match(approval, /\.returning\(\{ id: employees\.id \}\)/);
  assert.match(approval, /if \(updated\?\.id !== row\.employeeId\) throw new Error\(/);
  assert.doesNotMatch(approval, /tx\.update\(employees\)[\s\S]*?\.where\(eq\(employees\.id, row\.employeeId\)\)/);
});

test("optional-identifier conflict never overwrites another tenant's existing row", () => {
  assert.ok(approval);
  assert.match(approval, /\.onConflictDoUpdate\(\{[\s\S]*?target: \[essOtherIdentifiers\.employeeId, essOtherIdentifiers\.kind\]/);
  assert.match(approval, /setWhere: eq\(essOtherIdentifiers\.organizationId, organizationId\)/);
  assert.match(approval, /\.returning\(\{ id: essOtherIdentifiers\.id \}\)/);
  assert.match(approval, /if \(!updated\) throw new Error\("Identifier review optional identity scope changed\."\)/);
});

test("the final approval/rejection decision is an atomic employer, worker and pending-state update", () => {
  assert.ok(decision, "decision handler must exist");
  assert.match(decision, /eq\(essIdentifierRequests\.id, row\.id\)/);
  assert.match(decision, /eq\(essIdentifierRequests\.organizationId, organizationId\)/);
  assert.match(decision, /eq\(essIdentifierRequests\.employeeId, row\.employeeId\)/);
  assert.match(decision, /eq\(essIdentifierRequests\.status, "pending"\)/);
  assert.match(decision, /\.returning\(\{ id: essIdentifierRequests\.id \}\)/);
  assert.match(decision, /if \(decision\?\.id !== row\.id\) throw new Error\(/);
  assert.ok(route.indexOf("await recordAuditEvent({", route.indexOf('export async function POST')) >
    route.indexOf("const result = await db.transaction"), "audit must remain after transaction");
});

test("existing fictional PG16 own/victim proof stays a required independent gate", () => {
  const proof = readFileSync("scripts/qa/tenant-pii01-identifier-review-http.mjs", "utf8");
  const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  assert.match(proof, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(proof, /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
  assert.match(runner, /verifyPiiIdentifierReviewIsolation\(f, \{ request, expectStatus \}\)/);
});
