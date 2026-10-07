import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayoutChangeRequests,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  treasuryControlPolicies,
  users,
} from "../src/db/schema";
import { decryptBankAccount } from "../src/lib/bank-account-crypto";
import {
  createPayoutDestinationChangeRequest,
  decidePayoutDestinationChange,
  latestApprovedPayoutDestinationChangeForRun,
} from "../src/lib/payout-destination-controls";

const read = (path: string) => readFileSync(path, "utf8");

test("0073 adds immutable payout destination maker-checker persistence", () => {
  const migration = read("drizzle/0073_payout_destination_dual_control.sql");
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");

  for (const source of [migration, schema, baseline]) {
    assert.ok(source.includes("employee_payout_change_requests"));
    assert.ok(source.includes("original_state_sha256"));
    assert.ok(source.includes("proposed_bank_account"));
    assert.ok(source.includes("requested_by_user_id"));
    assert.ok(source.includes("decided_by_user_id"));
  }
  assert.ok(migration.includes("employee_payout_change_requests_open_employee_unique"));
  assert.ok(schema.includes("employee_payout_change_requests_status_check"));
});

test("treasury dual control applies payout changes only after a distinct stable-user approval", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const [org] = await db.insert(organizations).values({
    name: `Payout Dual Control ${suffix}`,
    legalName: `Payout Dual Control ${suffix} Inc.`,
  }).returning();
  const insertedUsers = await db.insert(users).values([
    {
      email: `dual-maker-${suffix}@example.com`,
      name: "Dual Maker",
      passwordHash: "test-only",
      role: "admin",
    },
    {
      email: `dual-checker-${suffix}@example.com`,
      name: "Dual Checker",
      passwordHash: "test-only",
      role: "owner",
    },
  ]).returning();
  const maker = insertedUsers[0];
  const checker = insertedUsers[1];

  try {
    await db.insert(treasuryControlPolicies).values({
      organizationId: org.id,
      enabled: true,
      requireReleaseSubmitterSeparation: true,
      enabledAt: new Date(),
    });

    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: `DUAL-${suffix}`.slice(0, 32),
      firstName: "Juan",
      lastName: "Dual",
      title: "Staff",
      avatarInitials: "JD",
      basicRate: "30000",
      bankAccount: "111122223333",
      bankCode: "BDO",
      mobile: "09170000000",
      startDate: "2026-01-01",
    }).returning();

    const request = await createPayoutDestinationChangeRequest({
      organizationId: org.id,
      employeeId: employee.id,
      requestedByUserId: maker.id,
      requestedByName: maker.name,
      reason: "Employee supplied a replacement payroll account.",
      replacementBankAccount: "999900001111",
      bankCode: "BPI",
      mobile: "09171111111",
    });
    assert.ok(request);
    assert.equal(request.status, "pending");
    assert.equal(request.proposedMaskedAccount, "••••1111");
    assert.equal("proposedBankAccount" in request, false, "safe request payload must not expose stored bank ciphertext or plaintext");

    const [unchanged] = await db.select().from(employees).where(eq(employees.id, employee.id)).limit(1);
    assert.equal(decryptBankAccount(unchanged.bankAccount), "111122223333");
    assert.equal(unchanged.bankCode, "BDO");

    const selfDecision = await decidePayoutDestinationChange({
      organizationId: org.id,
      requestId: request.id,
      decidedByUserId: maker.id,
      decidedByName: maker.name,
      decision: "approve",
    });
    assert.equal(selfDecision.kind, "forbidden");

    const approved = await decidePayoutDestinationChange({
      organizationId: org.id,
      requestId: request.id,
      decidedByUserId: checker.id,
      decidedByName: checker.name,
      decision: "approve",
      decisionNote: "Verified against employee-provided banking evidence.",
    });
    assert.equal(approved.kind, "approved");
    if (approved.kind !== "approved") throw new Error("Expected approved payout change.");
    assert.equal(decryptBankAccount(approved.employee.bankAccount), "999900001111");
    assert.equal(approved.employee.bankCode, "BPI");
    assert.equal(approved.employee.mobile, "09171111111");

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15 2026",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      payDate: "2026-10-15",
      status: "Released",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "30000",
      deductions: "5000",
      netPay: "25000",
    });
    const changed = await latestApprovedPayoutDestinationChangeForRun({
      organizationId: org.id,
      runId: run.id,
      after: new Date(0),
    });
    assert.equal(changed?.id, request.id);

    const staleRequest = await createPayoutDestinationChangeRequest({
      organizationId: org.id,
      employeeId: employee.id,
      requestedByUserId: maker.id,
      requestedByName: maker.name,
      reason: "Second destination request.",
      replacementBankAccount: "222233334444",
      bankCode: "BDO",
      mobile: "09172222222",
    });
    assert.ok(staleRequest);

    await db.update(employees).set({ mobile: "09999999999" }).where(eq(employees.id, employee.id));

    const stale = await decidePayoutDestinationChange({
      organizationId: org.id,
      requestId: staleRequest.id,
      decidedByUserId: checker.id,
      decidedByName: checker.name,
      decision: "approve",
    });
    assert.equal(stale.kind, "stale");

    const [cancelled] = await db.select().from(employeePayoutChangeRequests).where(and(
      eq(employeePayoutChangeRequests.id, staleRequest.id),
      eq(employeePayoutChangeRequests.organizationId, org.id),
    )).limit(1);
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, checker.id));
  }
});

test("employee API routes payout changes into dual control only when treasury separation is enabled", () => {
  const employeesRoute = read("src/app/api/employees/route.ts");
  assert.ok(employeesRoute.includes("treasuryControlPolicy"));
  assert.ok(employeesRoute.includes("createPayoutDestinationChangeRequest"));
  assert.ok(employeesRoute.includes("pendingApproval: true"));
  assert.ok(employeesRoute.includes("submit payout destination changes separately"));
  assert.ok(employeesRoute.includes("requireSensitiveActionMfa"));
  assert.ok(employeesRoute.includes("employee-payout-destination-change"));
});

test("payout change decisions require assigned treasury authority, MFA and maker-checker evidence", () => {
  const route = read("src/app/api/payout-destination-changes/[id]/route.ts");
  const treasury = read("src/lib/treasury-controls.ts");
  assert.ok(route.includes("authorizeAssignedTreasuryOperator"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("publicDemoMutationDenied"));
  assert.ok(treasury.includes("treasuryOperatorAssigned"));
  assert.ok(treasury.includes('"payroll.disburse"'));
});

test("PayMongo live submission and failed-only retry require a fresh preflight after destination change", () => {
  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const reconciliation = read("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts");
  for (const source of [exportsRoute, reconciliation]) {
    assert.ok(source.includes("latestApprovedPayoutDestinationChangeForRun"));
    assert.ok(source.includes("changed after the last PayMongo preflight"));
  }
  assert.ok(exportsRoute.includes("Run preflight again before submitting funds."));
  assert.ok(reconciliation.includes("Run preflight again before retrying failed transfers."));
});

test("employee profile surfaces pending payout maker-checker requests without exposing raw bank details", () => {
  const people = read("src/components/workspace/people.tsx");
  assert.ok(people.includes("Pending payout change #"));
  assert.ok(people.includes("payoutChangeReason"));
  assert.ok(people.includes("Submit payout change"));
  assert.ok(people.includes("decidePayoutChange"));
  assert.ok(people.includes("proposedMaskedAccount"));
  assert.equal(people.includes("proposedBankAccount"), false);
});
