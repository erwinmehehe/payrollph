import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employeePayoutChangeRequests, employees, legalEntities,
  organizations, treasuryControlPolicies, users,
} from "../src/db/schema";
import {
  createPayoutDestinationChangeRequest, decidePayoutDestinationChange,
  listPayoutDestinationChangeRequests, recordedPayoutChangeLegalEntityId,
} from "../src/lib/payout-destination-controls";

test("frozen payout-employer attribution refuses legacy, malformed and forged values", () => {
  for (const value of [null, {}, [], { legalEntityId: "11" }, { legalEntityId: 0 },
    { legalEntityId: -2 }, { legalEntityId: 1.5 }, { legalEntityId: 99999999999999999 }]) {
    assert.equal(recordedPayoutChangeLegalEntityId(value), null);
  }
  assert.equal(recordedPayoutChangeLegalEntityId({ legalEntityId: 11, maskedAccount: "••••1111" }), 11);
});

test("payout list and decision HTTP entrypoints bind selected and stored employer", () => {
  const list = readFileSync("src/app/api/payout-destination-changes/route.ts", "utf8");
  const decision = readFileSync("src/app/api/payout-destination-changes/[id]/route.ts", "utf8");
  const helper = readFileSync("src/lib/payout-destination-controls.ts", "utf8");

  assert.ok(list.includes("assertMembership(user.id, organizationId)"));
  assert.ok(list.includes("resolveMultiEntityContext({ userId: user.id, organizationId, request })"));
  assert.ok(list.includes("assertEntityResource(entity.context, employee.legalEntityId)"));
  assert.ok(list.includes("listPayoutDestinationChangeRequests({ organizationId, employeeId, legalEntityId })"));
  assert.ok(decision.includes("authorizeAssignedTreasuryOperator"));
  assert.ok(decision.includes("requireSensitiveActionMfa"));
  assert.ok(decision.includes("enforceSameOriginMutation"));
  assert.ok(decision.includes("resolveMultiEntityContext({ userId: user.id, organizationId, request })"));
  assert.ok(decision.includes("Number(body.legalEntityId) !== expectedLegalEntityId"));
  assert.ok(decision.includes("expectedLegalEntityId,"));
  assert.ok(helper.includes("eq(employeePayoutChangeRequests.organizationId, employees.organizationId)"));
  assert.ok(helper.includes("eq(employees.legalEntityId, input.legalEntityId)"));
  assert.ok(helper.includes("recordedPayoutChangeLegalEntityId(request.originalSnapshot)"));
  assert.ok(helper.includes("employee.legalEntityId !== input.expectedLegalEntityId"));
  assert.ok(helper.includes("organization_id = ${input.organizationId}"));
});

test("two employers in one tenant cannot list, approve or transfer each other's payout request", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: `Synthetic Payout Group ${suffix}`, legalName: "Fictional Payroll Group A" },
    { name: `Synthetic Payout Victim ${suffix}`, legalName: "Fictional Payroll Group B" },
  ]).returning();
  const [maker, checker] = await db.insert(users).values([
    { email: `payout-maker-${suffix}@example.invalid`, name: "Synthetic Maker",
      passwordHash: "synthetic-no-login", role: "admin" },
    { email: `payout-checker-${suffix}@example.invalid`, name: "Synthetic Checker",
      passwordHash: "synthetic-no-login", role: "owner" },
  ]).returning();

  try {
    const [alpha, beta, foreign] = await db.insert(legalEntities).values([
      { organizationId: orgA.id, code: "ALPHA", legalName: "Fictional Alpha Inc.",
        displayName: "Alpha", primaryEntity: true },
      { organizationId: orgA.id, code: "BETA", legalName: "Fictional Beta Corp.",
        displayName: "Beta", primaryEntity: false },
      { organizationId: orgB.id, code: "FOREIGN", legalName: "Fictional Other LLC",
        displayName: "Other", primaryEntity: true },
    ]).returning();
    await db.insert(treasuryControlPolicies).values([
      { organizationId: orgA.id, enabled: true, enabledAt: new Date() },
      { organizationId: orgB.id, enabled: true, enabledAt: new Date() },
    ]);
    const employeeBase = {
      title: "Fictional worker", avatarInitials: "FW",
      basicRate: "30000", startDate: "2026-01-01", bankCode: "BPI",
      mobile: "09170000000",
    };
    const [workerA, workerB, workerForeign] = await db.insert(employees).values([
      { ...employeeBase, organizationId: orgA.id, legalEntityId: alpha.id,
        employeeNo: `E-A-${suffix}`.slice(0, 32), firstName: "Alpha", lastName: "Worker",
        bankAccount: "000000000001" },
      { ...employeeBase, organizationId: orgA.id, legalEntityId: beta.id,
        employeeNo: `E-B-${suffix}`.slice(0, 32), firstName: "Beta", lastName: "Worker",
        bankAccount: "000000000002" },
      { ...employeeBase, organizationId: orgB.id, legalEntityId: foreign.id,
        employeeNo: `E-V-${suffix}`.slice(0, 32), firstName: "Victim", lastName: "Worker",
        bankAccount: "000000000003" },
    ]).returning();
    const submit = (organizationId: number, employeeId: number, replacementBankAccount: string) =>
      createPayoutDestinationChangeRequest({
        organizationId, employeeId, requestedByUserId: maker.id,
        requestedByName: maker.name, reason: "Synthetic verified destination update",
        replacementBankAccount, bankCode: "BDO", mobile: "09179999999",
      });
    const [requestA, requestB, requestForeign] = await Promise.all([
      submit(orgA.id, workerA.id, "000000000011"),
      submit(orgA.id, workerB.id, "000000000022"),
      submit(orgB.id, workerForeign.id, "000000000033"),
    ]);
    assert.ok(requestA && requestB && requestForeign);
    assert.equal(recordedPayoutChangeLegalEntityId(requestA.originalSnapshot), alpha.id);
    assert.equal(recordedPayoutChangeLegalEntityId(requestB.originalSnapshot), beta.id);

    const ids = async (organizationId: number, legalEntityId: number, employeeId?: number) =>
      (await listPayoutDestinationChangeRequests({ organizationId, legalEntityId, employeeId }))
        .map(row => row.id);
    assert.deepEqual(await ids(orgA.id, alpha.id), [requestA.id]);
    assert.deepEqual(await ids(orgA.id, beta.id), [requestB.id]);
    assert.deepEqual(await ids(orgA.id, alpha.id, workerB.id), []);
    assert.deepEqual(await ids(orgA.id, beta.id, workerA.id), []);
    assert.deepEqual(await ids(orgA.id, alpha.id, workerForeign.id), []);
    assert.deepEqual(await ids(orgA.id, -1), []);
    assert.deepEqual(await ids(orgB.id, foreign.id), [requestForeign.id]);

    const snapshot = async (organizationId: number, employeeId: number, requestId: number) => ({
      employee: await db.select().from(employees).where(and(
        eq(employees.organizationId, organizationId), eq(employees.id, employeeId),
      )),
      request: await db.select().from(employeePayoutChangeRequests).where(and(
        eq(employeePayoutChangeRequests.organizationId, organizationId),
        eq(employeePayoutChangeRequests.id, requestId),
      )),
      audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)),
    });
    const beforeB = await snapshot(orgA.id, workerB.id, requestB.id);
    const beforeForeign = await snapshot(orgB.id, workerForeign.id, requestForeign.id);
    const decide = (organizationId: number, requestId: number, expectedLegalEntityId: number) =>
      decidePayoutDestinationChange({
        organizationId, requestId, expectedLegalEntityId,
        decidedByUserId: checker.id, decidedByName: checker.name, decision: "approve",
      });
    assert.equal((await decide(orgA.id, requestB.id, alpha.id)).kind, "forbidden");
    assert.deepEqual(await snapshot(orgA.id, workerB.id, requestB.id), beforeB);
    assert.equal((await decide(orgA.id, requestForeign.id, alpha.id)).kind, "not_found");
    assert.deepEqual(await snapshot(orgB.id, workerForeign.id, requestForeign.id), beforeForeign);

    // Employer transfer while a request is pending: neither old nor new employer
    // can see or approve this stale bank request.
    await db.update(employees).set({ legalEntityId: beta.id })
      .where(and(eq(employees.id, workerA.id), eq(employees.organizationId, orgA.id)));
    assert.deepEqual(await ids(orgA.id, alpha.id), []);
    assert.deepEqual(await ids(orgA.id, beta.id), [requestB.id]);
    const beforeA = await snapshot(orgA.id, workerA.id, requestA.id);
    assert.equal((await decide(orgA.id, requestA.id, alpha.id)).kind, "forbidden");
    assert.equal((await decide(orgA.id, requestA.id, beta.id)).kind, "forbidden");
    assert.deepEqual(await snapshot(orgA.id, workerA.id, requestA.id), beforeA);

    // Correctly selected independent checker still approves the other worker.
    const approved = await decide(orgA.id, requestB.id, beta.id);
    assert.equal(approved.kind, "approved");
    assert.equal((await ids(orgA.id, beta.id)).includes(requestB.id), true);
    const [afterB] = await db.select().from(employees).where(eq(employees.id, workerB.id)).limit(1);
    assert.equal(afterB.bankCode, "BDO");
    assert.deepEqual(await snapshot(orgB.id, workerForeign.id, requestForeign.id), beforeForeign);

    // A legacy request without frozen employer attribution stays invisible on
    // entity-scoped reads and cannot be approved after enabling multi-entity.
    await db.update(employeePayoutChangeRequests)
      .set({ originalSnapshot: { maskedAccount: "••••0001", bankCode: "BPI", mobile: null } })
      .where(eq(employeePayoutChangeRequests.id, requestA.id));
    await db.update(employees).set({ legalEntityId: alpha.id })
      .where(eq(employees.id, workerA.id));
    assert.deepEqual(await ids(orgA.id, alpha.id), []);
    const beforeLegacy = await snapshot(orgA.id, workerA.id, requestA.id);
    assert.equal((await decide(orgA.id, requestA.id, alpha.id)).kind, "forbidden");
    assert.deepEqual(await snapshot(orgA.id, workerA.id, requestA.id), beforeLegacy);
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [orgA.id, orgB.id]));
    await db.delete(users).where(inArray(users.id, [maker.id, checker.id]));
  }
});
