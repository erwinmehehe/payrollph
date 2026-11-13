/**
 * HR Cases POST/PATCH tenant write-isolation contract.
 * Source-pinned, fictional PostgreSQL 16 localhost only, ZERO coverage credit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORIGIN, gitBlobSha, requireDisposableHrPageEnv,
  verifyHrPageSourcePins, assertNoOtherEmployerMarkers, assertReadOnlySql,
} from "./tenant-hr-cases-page-contract.mjs";

export const API_PATH = "/api/hr-cases";
export const WRITE_SOURCE_PINS = Object.freeze({
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "scripts/qa/apply-isolated-baseline.mjs": "75b9e7f1b39a6ca5b2253086e519ae7d71229255",
});

export function requireDisposableHrWriteEnv(env = process.env) {
  requireDisposableHrPageEnv(env);
  assert.equal(env.TENANT_HR_CASE_WRITE_PROOF, "fictional-pg16-post-patch-only",
    "HR_CASE_WRITE_REFUSED: wrong explicit proof mode");
  assert.equal(env.EMPLOYEE_HR_CASES_ENABLED, "true");
  assert.equal(env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "false");
  return true;
}

export function verifyHrWriteSourcePins(root = process.cwd()) {
  verifyHrPageSourcePins(root);
  for (const [path, sha] of Object.entries(WRITE_SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(resolve(root, path))), sha,
      "HR_CASE_WRITE_REFUSED: unreviewed dependency " + path);
  }
  const route = readFileSync(resolve(root, "src/app/api/hr-cases/route.ts"), "utf8");
  const post = route.slice(route.indexOf("export async function POST(request: Request)"),
    route.indexOf("async function approveCoeWithRecovery("));
  const patch = route.slice(route.indexOf("export async function PATCH(request: Request)"));
  for (const section of [post, patch]) {
    assert.ok(section.startsWith("export async function"), "HR_CASE_WRITE_REFUSED: missing handler");
    for (const gate of ["enabled()", "enforceSameOriginMutation(request)", "getSessionUser()"]) {
      assert.ok(section.includes(gate), "HR_CASE_WRITE_REFUSED: removed write gate " + gate);
    }
    assert.ok(section.indexOf("enforceSameOriginMutation(request)") <
      section.indexOf("getSessionUser()"),
      "HR_CASE_WRITE_REFUSED: origin check must precede auth");
  }
  for (const gate of [
    "employeeForSession(user)", "worker.organizationId", "worker.id",
    "await db.transaction(", "employeeHrCaseMessages", "auditEvents",
  ]) assert.ok(post.includes(gate), "HR_CASE_WRITE_REFUSED: POST lost " + gate);
  assert.ok(post.indexOf("employeeForSession(user)") < post.indexOf("await db.transaction("),
    "HR_CASE_WRITE_REFUSED: worker identity before insert");
  for (const gate of [
    "linkedEmployeeHrCaseScope(", "activeHrCaseStaffMembership(user.id)",
    "assertOrganizationRole(user.id, existing.organizationId",
    "hrCaseRoleCanWork(", "resolveMultiEntityContext(",
    "assertEntityResource(", "assertScope(", "hrCaseNotFound()",
    "requireSensitiveActionMfa(user)", "criticalReleaseFlagEnabled",
    "await db.transaction(", "auditEvents",
  ]) assert.ok(patch.includes(gate), "HR_CASE_WRITE_REFUSED: PATCH lost " + gate);
  return true;
}

const id = value => Number.isSafeInteger(value) && value > 0;
// Every refusal must protect ALL populated employers, including bystanders.
// A denial against B must not silently mutate the separate victim's data.
export function allProtectedEmployers(actors, selected = []) {
  const byId = new Map();
  for (const actor of [...actors, ...selected]) {
    assert.ok(id(actor?.org?.id), "Protected comparator requires a real employer ID");
    byId.set(actor.org.id, actor);
  }
  return [...byId.values()];
}
export function assertCreatedEmployeeCase(response, actor, employeeUserId, expectedType) {
  assert.equal(response.status, 201, "Owned employee case must be created by real HTTP");
  const row = response.json?.case;
  assert.ok(row && id(row.id), "Missing persisted case ID");
  assert.equal(row.organizationId, actor.org.id, "POST escaped linked employer");
  assert.equal(row.employeeId, actor.worker.id, "POST escaped linked worker");
  assert.equal(row.createdByUserId, employeeUserId, "Wrong originating employee account");
  assert.equal(row.caseType, expectedType);
  assert.ok(row.subject.includes(actor.marker), "Real own marker missing");
  return row.id;
}
export function assertOwnCasePatch(response, caseId, employerId) {
  assert.equal(response.status, 200, "Owned PATCH must really succeed");
  assert.equal(response.json?.case?.id, caseId);
  assert.equal(response.json?.case?.organizationId, employerId);
}
export function assertDeniedCaseMutation(response, expectedStatus, actors, label) {
  assert.equal(response.status, expectedStatus,
    label + ": incorrect status: " + response.status + " " + response.text.slice(0, 160));
  assert.ok(!response.json?.case, label + ": denial exposed a private case");
  assertNoOtherEmployerMarkers(response, actors, label);
}
export function assertForeignSqlUnchanged(before, after, label) {
  assertReadOnlySql(before, after, label);
}
export { ORIGIN };
