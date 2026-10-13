import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalChainInstanceSteps, approvalChainInstances, approvalChainPolicies,
  approvalTasks, auditEvents, organizations,
} from "../src/db/schema";
import { runDueApprovalChainEscalations } from "../src/lib/approval-chain-escalation-server";

/**
 * Uses the disposable PostgreSQL regression database, not a real employer.
 * Tests both a feature rollback and two competing scheduler calls; escalation
 * is advisory and must never decide a chain or release payroll.
 */
test("overdue escalation is tenant-scoped, atomic, idempotent, and flag-off safe", async () => {
  const previous = process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED;
  const suffix = randomUUID().slice(0, 8);
  let organizationIds: number[] = [];
  try {
    const [alpha, beta] = await db.insert(organizations).values([
      { name: "Escalation Alpha " + suffix, legalName: "Escalation Alpha " + suffix },
      { name: "Escalation Beta " + suffix, legalName: "Escalation Beta " + suffix },
    ]).returning();
    organizationIds = [alpha.id, beta.id];
    const snapshot = [
      { label: "Independent review", approver: "role:hr", minimumAmount: 0, escalationAfterDays: 2 },
    ];
    const legacy = [{ label: "Legacy review", approver: "role:hr", minimumAmount: 0 }];
    const [alphaPolicy, betaPolicy] = await db.insert(approvalChainPolicies).values([
      { organizationId: alpha.id, code: "synthetic-" + suffix, name: "Synthetic escalation",
        purpose: "automation", steps: snapshot },
      { organizationId: beta.id, code: "synthetic-" + suffix, name: "Synthetic legacy",
        purpose: "automation", steps: legacy },
    ]).returning();
    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * 86_400_000);
    const [alphaInstance, betaInstance] = await db.insert(approvalChainInstances).values([
      { organizationId: alpha.id, policyId: alphaPolicy.id, policyCode: alphaPolicy.code,
        policyVersion: alphaPolicy.version, sourceType: "automation_request_approval",
        sourceKey: "synthetic-" + suffix, stepsSnapshot: snapshot, createdAt: fourDaysAgo },
      { organizationId: beta.id, policyId: betaPolicy.id, policyCode: betaPolicy.code,
        policyVersion: betaPolicy.version, sourceType: "automation_request_approval",
        sourceKey: "synthetic-" + suffix, stepsSnapshot: legacy, createdAt: fourDaysAgo },
    ]).returning();
    const [alphaTask, betaTask] = await db.insert(approvalTasks).values([
      { organizationId: alpha.id, title: "Synthetic A", detail: "No employee data",
        approver: "role:hr", dueLabel: "Review due", approvalChainInstanceId: alphaInstance.id,
        approvalChainStepIndex: 0 },
      { organizationId: beta.id, title: "Synthetic B", detail: "No employee data",
        approver: "role:hr", dueLabel: "Review due", approvalChainInstanceId: betaInstance.id,
        approvalChainStepIndex: 0 },
    ]).returning();
    await db.insert(approvalChainInstanceSteps).values([
      { organizationId: alpha.id, instanceId: alphaInstance.id, stepIndex: 0,
        label: "Independent review", approver: "role:hr", approvalTaskId: alphaTask.id },
      { organizationId: beta.id, instanceId: betaInstance.id, stepIndex: 0,
        label: "Legacy review", approver: "role:hr", approvalTaskId: betaTask.id },
    ]);

    process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED = "false";
    const held = await runDueApprovalChainEscalations(now);
    assert.deepEqual(held, { skipped: true, raised: 0 });
    const [before] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, alphaTask.id));
    assert.equal(before.priority, "Normal");

    process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED = "true";
    const results = await Promise.all([
      runDueApprovalChainEscalations(now), runDueApprovalChainEscalations(now),
    ]);
    assert.equal(results.reduce((count, result) => count + result.raised, 0), 1,
      "concurrent scheduler ticks must make exactly one transition");
    const [afterA, afterB] = await Promise.all([
      db.select().from(approvalTasks).where(eq(approvalTasks.id, alphaTask.id)),
      db.select().from(approvalTasks).where(eq(approvalTasks.id, betaTask.id)),
    ]);
    assert.equal(afterA[0].priority, "High");
    assert.equal(afterA[0].status, "Pending", "notification may not decide approval");
    assert.equal(afterB[0].priority, "Normal", "an unrelated tenant/legacy policy is untouched");
    assert.equal(afterB[0].status, "Pending");

    const receipts = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, alpha.id),
      eq(auditEvents.action, "Approval chain overdue escalation"),
    ));
    assert.equal(receipts.length, 1, "exactly one persistent audit receipt after concurrent ticks");
    const evidence = receipts[0].metadata as Record<string, unknown>;
    assert.equal(evidence.approvalTaskId, alphaTask.id);
    assert.equal(evidence.instanceId, alphaInstance.id);
    assert.equal(evidence.stepIndex, 0);
    assert.equal(evidence.escalationAfterDays, 2);

    const again = await runDueApprovalChainEscalations(new Date(now.getTime() + 60_000));
    assert.equal(again.raised, 0);
    const reread = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, alpha.id),
      eq(auditEvents.action, "Approval chain overdue escalation"),
    ));
    assert.equal(reread.length, 1, "retry may not duplicate persistent evidence");
  } finally {
    if (previous === undefined) delete process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED;
    else process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED = previous;
    if (organizationIds.length) {
      await db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
  }
});
