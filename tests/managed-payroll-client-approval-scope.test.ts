import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeManagedPayrollClientApprover } from "../src/lib/managed-payroll-client-approval";

const org = 27;
const actor = 18;
const membership = {
  userId: actor, organizationId: org, active: true,
  role: "owner", orgUnitId: null,
};
const engagement = { organizationId: org, clientApproverUserId: actor };

test("only an active company-wide owner/admin designated by this employer may approve", () => {
  assert.equal(activeManagedPayrollClientApprover(actor, org, membership, engagement), true);
  assert.equal(activeManagedPayrollClientApprover(actor, org, { ...membership, role: "admin" }, engagement), true);
  const invalid = [
    ["revoked membership", { ...membership, active: false }, engagement],
    ["different employee account", { ...membership, userId: 19 }, engagement],
    ["other employer membership", { ...membership, organizationId: 28 }, engagement],
    ["unit-scoped admin", { ...membership, role: "admin", orgUnitId: 4 }, engagement],
    ["payroll operator", { ...membership, role: "payroll" }, engagement],
    ["checker", { ...membership, role: "checker" }, engagement],
    ["inactive supervisor", { ...membership, role: "hr", active: false }, engagement],
    ["reassigned approver", membership, { ...engagement, clientApproverUserId: 19 }],
    ["foreign engagement", membership, { ...engagement, organizationId: 28 }],
    ["missing membership", null, engagement],
    ["missing engagement", membership, null],
  ] as const;
  for (const [label, candidate, managed] of invalid) {
    assert.equal(activeManagedPayrollClientApprover(actor, org, candidate, managed), false, label);
  }
});

test("client approval resolves IDs only through an active scoped membership before reading employer state", () => {
  const route = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");
  const entry = route.indexOf("export async function POST(");
  const lookup = route.indexOf(".from(payrollRuns)", entry);
  const membershipJoin = route.indexOf(".innerJoin(userOrganizations", lookup);
  const engagementLookup = route.indexOf(".from(managedPayrollEngagements)", entry);
  assert.ok(entry >= 0 && lookup > entry && membershipJoin > lookup);
  assert.ok(membershipJoin < engagementLookup, "membership join must precede engagement lookup");
  assert.match(route, /eq\(userOrganizations\.active, true\)/);
  assert.match(route, /isNull\(userOrganizations\.orgUnitId\)/);
  assert.match(route, /inArray\(userOrganizations\.role, \["owner", "admin"\]\)/);
  assert.match(route, /const run = scopedRun\.run/);
  assert.match(route, /if \(!scopedRun\) return runNotFound\(\)/);
  assert.ok((route.match(/activeManagedPayrollClientApprover\(/g) ?? []).length >= 2);
});

test("revoked grant and switched engagement are rechecked under database locks before any approval or audit write", () => {
  const route = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");
  const transaction = route.indexOf("db.transaction(async (tx) =>");
  assert.ok(transaction > 0);
  const body = route.slice(transaction);
  assert.match(body, /FROM user_organizations[\s\S]*?FOR SHARE/);
  assert.match(body, /FROM managed_payroll_engagements[\s\S]*?FOR SHARE/);
  assert.match(body, /FROM payroll_runs[\s\S]*?FOR UPDATE/);
  assert.match(body, /activeManagedPayrollClientApprover\(user\.id, run\.organizationId, freshMembership, freshEngagement\)/);
  assert.match(body, /freshRun\.organizationId !== run\.organizationId/);
  assert.match(body, /\.where\(and\([\s\S]*?eq\(managedPayrollRunApprovals\.engagementId, engagement\.id\)/);
  const firstWrite = Math.min(
    ...[body.indexOf("tx.update(managedPayrollRunApprovals)"), body.indexOf("tx.insert(managedPayrollRunApprovals)")].filter(i => i >= 0),
  );
  assert.ok(body.indexOf("activeManagedPayrollClientApprover(") < firstWrite, "grant checked before first write");
  assert.ok(body.includes("}, tx)"), "approval and audit must be one transaction");
  assert.match(body, /managedPayrollRunFingerprint\(run\.id, tx\)/);
  const fingerprintHelper = readFileSync("src/lib/managed-payroll.ts", "utf8");
  assert.match(fingerprintHelper, /reader: Pick<typeof db, "select"> = db/);
  assert.match(fingerprintHelper, /await reader\.select\(/);
});

test("checker evidence and separation of duties are evaluated inside the locked approval transaction", () => {
  const route = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");
  const txIndex = route.indexOf("return db.transaction(async (tx) =>");
  const beforeTx = route.slice(0, txIndex);
  const tx = route.slice(txIndex);
  const runLock = tx.indexOf("FROM payroll_runs");
  const checkerRead = tx.indexOf("const approvalEvents = await tx.select().from(auditEvents)");
  const checkerGuard = tx.indexOf("if (!checkerDecision)");
  const separationGuard = tx.indexOf("if (sameAuthenticatedChecker)");
  const firstApprovalWrite = Math.min(
    tx.indexOf("tx.update(managedPayrollRunApprovals)"),
    tx.indexOf("tx.insert(managedPayrollRunApprovals)"),
  );
  assert.ok(runLock >= 0 && checkerRead > runLock, "checker evidence must be read after the run lock");
  assert.ok(checkerGuard > checkerRead && separationGuard > checkerGuard,
    "checker approval and separation of duties must be enforced");
  assert.ok(separationGuard < firstApprovalWrite, "checker gate must run before writing an approval");
  assert.doesNotMatch(beforeTx, /const approvalEvents = await db\.select\(\)\.from\(auditEvents\)/);
});
