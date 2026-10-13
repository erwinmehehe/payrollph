import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalChainInstanceSteps, approvalChainInstances, approvalChainPolicies,
  approvalTasks, auditEvents, organizations, outbox, userOrganizations, users,
} from "../src/db/schema";
import { runDueApprovalChainEscalations } from "../src/lib/approval-chain-escalation-server";
import { retryOutboxMessage } from "../src/lib/mailer";

test("advisory destination writes one tenant-bound outbox receipt; inactive and foreign recipients are blocked", async () => {
  const prevFlag = process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED;
  const secrets = {
    resend: process.env.RESEND_API_KEY,
    postmark: process.env.POSTMARK_SERVER_TOKEN,
    smtp: process.env.SMTP_URL,
  };
  let organizationIds: number[] = [];
  let userId: number | null = null;
  const suffix = randomUUID().slice(0, 12);
  try {
    // Synthetic only; never permit a real mail provider in regression QA.
    delete process.env.RESEND_API_KEY;
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.SMTP_URL;
    const [alpha, beta] = await db.insert(organizations).values([
      { name: "Escalation delivery alpha " + suffix, legalName: "Escalation delivery alpha " + suffix },
      { name: "Escalation delivery beta " + suffix, legalName: "Escalation delivery beta " + suffix },
    ]).returning();
    organizationIds = [alpha.id, beta.id];
    const [actor] = await db.insert(users).values({
      email: "escalation-" + suffix + "@example.test", name: "Synthetic HR reviewer",
      role: "hr", passwordHash: "no-login", active: true,
    }).returning();
    userId = actor.id;
    const [membership] = await db.insert(userOrganizations).values({
      userId: actor.id, organizationId: alpha.id, role: "hr", active: true,
    }).returning();
    const snapshot = [{
      label: "Synthetic review", approver: "role:finance", minimumAmount: 0,
      escalationAfterDays: 1, escalationRecipient: "user:" + actor.id,
    }];
    const now = new Date();
    const ago = new Date(now.getTime() - 3 * 86_400_000);
    async function createPending(organizationId: number, token: string) {
      const [policy] = await db.insert(approvalChainPolicies).values({
        organizationId, code: "escalation-" + token, name: "Escalation " + token,
        purpose: "automation", steps: snapshot,
      }).returning();
      const [instance] = await db.insert(approvalChainInstances).values({
        organizationId, policyId: policy.id, policyCode: policy.code,
        policyVersion: policy.version, sourceType: "automation_request_approval",
        sourceKey: "escalation-" + token, stepsSnapshot: snapshot, createdAt: ago,
      }).returning();
      const [task] = await db.insert(approvalTasks).values({
        organizationId, title: "Synthetic approval", detail: "Synthetic fixture only",
        approver: "role:finance", dueLabel: "Review", approvalChainInstanceId: instance.id,
        approvalChainStepIndex: 0,
      }).returning();
      await db.insert(approvalChainInstanceSteps).values({
        organizationId, instanceId: instance.id, stepIndex: 0,
        label: "Synthetic review", approver: "role:finance", approvalTaskId: task.id,
      });
      return { instance, task };
    }
    const own = await createPending(alpha.id, suffix + "-a");
    const foreign = await createPending(beta.id, suffix + "-b");
    process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED = "true";
    await Promise.all([runDueApprovalChainEscalations(now), runDueApprovalChainEscalations(now)]);
    const rows = await db.select().from(outbox)
      .where(eq(outbox.organizationId, alpha.id));
    const messages = rows.filter(row => row.purpose === "approval-chain-escalation");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].recipient, actor.email);
    assert.equal(messages[0].status, "queued");
    assert.equal(messages[0].maxAttempts, 4, "Advisory notices must participate in the bounded automatic retry worker");
    assert.ok(!messages[0].body.includes("Synthetic approval"));
    assert.ok(!messages[0].body.includes("Synthetic fixture"));
    const betaOutbox = await db.select().from(outbox)
      .where(eq(outbox.organizationId, beta.id));
    assert.equal(betaOutbox.filter(row => row.purpose === "approval-chain-escalation").length, 0,
      "A user in organization A must never receive an advisory for organization B");
    const [ownTask, foreignTask] = await Promise.all([
      db.select().from(approvalTasks).where(eq(approvalTasks.id, own.task.id)),
      db.select().from(approvalTasks).where(eq(approvalTasks.id, foreign.task.id)),
    ]);
    assert.equal(ownTask[0].approver, "role:finance", "the approver must never be reassigned");
    assert.equal(ownTask[0].status, "Pending");
    assert.equal(foreignTask[0].approver, "role:finance");
    const blocked = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, beta.id),
      eq(auditEvents.action, "Approval chain overdue escalation"),
    ));
    assert.equal(blocked.length, 1);
    assert.equal((blocked[0].metadata as Record<string, unknown>).notificationState,
      "blocked_no_active_recipient");

    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.id, membership.id));
    const staleRetry = await retryOutboxMessage({
      id: messages[0].id, organizationId: alpha.id,
      actor: "Synthetic scheduler", trigger: "manual",
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.httpStatus, 409,
      "A revoked recipient must not receive a previously queued advisory");
    const [tombstone] = await db.select().from(outbox).where(eq(outbox.id, messages[0].id));
    assert.equal(tombstone.status, "failed");
    assert.equal(tombstone.deliveryStatus, "blocked");
    assert.equal(tombstone.maxAttempts, 0,
      "A revoked advisory must never be retried later, even after reactivation");
    await runDueApprovalChainEscalations(new Date(now.getTime() + 60_000));
    const replay = await db.select().from(outbox)
      .where(eq(outbox.organizationId, alpha.id));
    assert.equal(replay.filter(row => row.purpose === "approval-chain-escalation").length, 1);
    const another = await createPending(alpha.id, suffix + "-inactive");
    await runDueApprovalChainEscalations(new Date(now.getTime() + 60_000));
    const later = await db.select().from(outbox)
      .where(eq(outbox.organizationId, alpha.id));
    assert.equal(later.filter(row => row.purpose === "approval-chain-escalation").length, 1,
      "Revoked membership cannot receive a new escalation notice");
    const [lastTask] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, another.task.id));
    assert.equal(lastTask.approver, "role:finance");
  } finally {
    if (prevFlag === undefined) delete process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED;
    else process.env.APPROVAL_CHAIN_ESCALATIONS_ENABLED = prevFlag;
    for (const [key, value] of [
      ["RESEND_API_KEY", secrets.resend], ["POSTMARK_SERVER_TOKEN", secrets.postmark],
      ["SMTP_URL", secrets.smtp],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (organizationIds.length) {
      await db.delete(outbox).where(inArray(outbox.organizationId, organizationIds));
      await db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userId !== null) await db.delete(users).where(eq(users.id, userId));
  }
});
