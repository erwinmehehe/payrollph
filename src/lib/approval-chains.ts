import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalChainInstanceSteps,
  approvalChainInstances,
  approvalChainPolicies,
  approvalTasks,
} from "@/db/schema";

export type ApprovalChainStepDefinition = {
  label: string;
  approver: string;
  dueLabel?: string;
  priority?: string;
  minimumAmount?: number;
};

function normalizeApprovalChainSteps(value: unknown): ApprovalChainStepDefinition[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const steps: ApprovalChainStepDefinition[] = [];
  let previousMinimum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const label = String(row.label ?? "").trim();
    const approver = String(row.approver ?? "").trim();
    const dueLabel = String(row.dueLabel ?? "Review required").trim();
    const priority = String(row.priority ?? "Normal").trim();
    const minimumRaw = row.minimumAmount == null || row.minimumAmount === "" ? 0 : Number(row.minimumAmount);
    if (!label || !approver || !Number.isFinite(minimumRaw) || minimumRaw < 0 || minimumRaw > 999_999_999_999.99) {
      return null;
    }
    const minimumAmount = Math.round(minimumRaw * 100) / 100;
    if (index === 0 && minimumAmount !== 0) return null;
    if (minimumAmount < previousMinimum) return null;
    previousMinimum = minimumAmount;
    steps.push({
      label: label.slice(0, 120),
      approver: approver.slice(0, 120),
      dueLabel: dueLabel.slice(0, 80) || "Review required",
      priority: priority.slice(0, 32) || "Normal",
      minimumAmount,
    });
  }
  return steps;
}

export function approvalStepsForAmount(
  steps: ApprovalChainStepDefinition[],
  amount?: number | null,
) {
  if (amount == null) return steps;
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Approval amount must be a non-negative finite number.");
  const rounded = Math.round(amount * 100) / 100;
  return steps.filter((step) => Number(step.minimumAmount ?? 0) <= rounded);
}

export function validateApprovalChainSteps(value: unknown) {
  return normalizeApprovalChainSteps(value);
}

export async function createApprovalFromConfiguredChain(input: {
  organizationId: number;
  chainCode?: string | null;
  sourceType: string;
  sourceKey: string;
  title: string;
  detail: string;
  fallbackApprover: string;
  dueLabel?: string;
  priority?: string;
  amount?: number | null;
  amountCurrency?: string;
  amountBasis?: string;
}) {
  const chainCode = String(input.chainCode ?? "").trim();
  if (!chainCode) {
    const [task] = await db.insert(approvalTasks).values({
      organizationId: input.organizationId,
      title: input.title.slice(0, 180),
      detail: input.detail.slice(0, 240),
      approver: input.fallbackApprover.slice(0, 120),
      dueLabel: (input.dueLabel ?? "Review required").slice(0, 80),
      priority: (input.priority ?? "Normal").slice(0, 32),
    }).returning();
    return { task, chainInstance: null, chainStep: null };
  }

  const [policy] = await db.select().from(approvalChainPolicies).where(and(
    eq(approvalChainPolicies.organizationId, input.organizationId),
    eq(approvalChainPolicies.code, chainCode),
    eq(approvalChainPolicies.active, true),
  )).limit(1);
  if (!policy) throw new Error(`Active approval chain "${chainCode}" was not found.`);

  const steps = normalizeApprovalChainSteps(policy.steps);
  if (!steps) throw new Error(`Approval chain "${chainCode}" has an invalid step definition.`);
  const amount = input.amount == null ? null : Math.round(Number(input.amount) * 100) / 100;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    throw new Error("Approval amount must be a non-negative finite number.");
  }
  const amountCurrency = amount == null ? null : String(input.amountCurrency ?? "PHP").trim().toUpperCase().slice(0, 3);
  const amountBasis = amount == null ? null : String(input.amountBasis ?? "declared_amount").trim().slice(0, 64);
  const routedSteps = approvalStepsForAmount(steps, amount);
  if (routedSteps.length < 1) throw new Error(`Approval chain "${chainCode}" has no applicable approval step.`);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(approvalChainInstances).where(and(
      eq(approvalChainInstances.organizationId, input.organizationId),
      eq(approvalChainInstances.sourceType, input.sourceType),
      eq(approvalChainInstances.sourceKey, input.sourceKey),
    )).limit(1);
    if (existing) {
      const existingAmount = existing.amount == null ? null : Number(existing.amount);
      if (
        existing.policyCode !== policy.code
        || existingAmount !== amount
        || (existing.amountCurrency ?? null) !== amountCurrency
        || (existing.amountBasis ?? null) !== amountBasis
      ) {
        throw new Error("Approval chain idempotency conflict: routing inputs changed after the chain started.");
      }
      const [step] = await tx.select().from(approvalChainInstanceSteps).where(and(
        eq(approvalChainInstanceSteps.instanceId, existing.id),
        eq(approvalChainInstanceSteps.stepIndex, existing.currentStepIndex),
      )).limit(1);
      const [task] = step?.approvalTaskId
        ? await tx.select().from(approvalTasks).where(eq(approvalTasks.id, step.approvalTaskId)).limit(1)
        : [];
      if (!task) throw new Error("Existing approval chain instance is missing its current approval task.");
      return { task, chainInstance: existing, chainStep: step ?? null };
    }

    const [instance] = await tx.insert(approvalChainInstances).values({
      organizationId: input.organizationId,
      policyId: policy.id,
      policyCode: policy.code,
      policyVersion: policy.version,
      sourceType: input.sourceType.slice(0, 48),
      sourceKey: input.sourceKey.slice(0, 160),
      status: "pending",
      currentStepIndex: 0,
      stepsSnapshot: routedSteps,
      amount: amount == null ? null : amount.toFixed(2),
      amountCurrency,
      amountBasis,
      routingSnapshot: {
        amount,
        amountCurrency,
        amountBasis,
        policySteps: steps,
        appliedSteps: routedSteps,
      },
    }).returning();

    const first = routedSteps[0];
    const [task] = await tx.insert(approvalTasks).values({
      organizationId: input.organizationId,
      title: input.title.slice(0, 180),
      detail: input.detail.slice(0, 240),
      approver: first.approver,
      dueLabel: (first.dueLabel ?? input.dueLabel ?? "Review required").slice(0, 80),
      priority: (first.priority ?? input.priority ?? "Normal").slice(0, 32),
      approvalChainInstanceId: instance.id,
      approvalChainStepIndex: 0,
    }).returning();

    const [step] = await tx.insert(approvalChainInstanceSteps).values({
      organizationId: input.organizationId,
      instanceId: instance.id,
      stepIndex: 0,
      label: first.label,
      approver: first.approver,
      status: "pending",
      approvalTaskId: task.id,
    }).returning();

    return { task, chainInstance: instance, chainStep: step };
  });
}

type ApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function advanceApprovalChainAfterDecisionTx(
  tx: ApprovalTransaction,
  input: {
    taskId: number;
    decision: "Approved" | "Declined";
    decidedBy: string;
  },
) {
  const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, input.taskId)).limit(1);
  if (!task?.approvalChainInstanceId || task.approvalChainStepIndex == null) {
    return { isChain: false, final: true, nextTaskId: null, instanceId: null };
  }

  await tx.execute(sql`
    select id from approval_chain_instances
    where id = ${task.approvalChainInstanceId}
    for update
  `);

  const [instance] = await tx.select().from(approvalChainInstances).where(
    eq(approvalChainInstances.id, task.approvalChainInstanceId),
  ).limit(1);
  if (!instance) throw new Error("Approval chain instance no longer exists.");
  if (instance.status !== "pending") {
    return {
      isChain: true,
      final: true,
      nextTaskId: null,
      instanceId: instance.id,
      status: instance.status,
    };
  }
  if (instance.currentStepIndex !== task.approvalChainStepIndex) {
    throw new Error("Approval chain already advanced to another step.");
  }

  const [step] = await tx.update(approvalChainInstanceSteps).set({
    status: input.decision === "Approved" ? "approved" : "declined",
    decidedBy: input.decidedBy.slice(0, 120),
    decidedAt: new Date(),
  }).where(and(
    eq(approvalChainInstanceSteps.instanceId, instance.id),
    eq(approvalChainInstanceSteps.stepIndex, task.approvalChainStepIndex),
    eq(approvalChainInstanceSteps.status, "pending"),
  )).returning();
  if (!step) throw new Error("Approval chain step was already decided.");

  if (input.decision === "Declined") {
    await tx.update(approvalChainInstances).set({
      status: "declined",
      completedAt: new Date(),
    }).where(eq(approvalChainInstances.id, instance.id));
    return { isChain: true, final: true, nextTaskId: null, instanceId: instance.id, status: "declined" };
  }

  const snapshot = normalizeApprovalChainSteps(instance.stepsSnapshot);
  if (!snapshot) throw new Error("Approval chain snapshot is invalid.");
  const nextIndex = task.approvalChainStepIndex + 1;
  const next = snapshot[nextIndex];
  if (!next) {
    await tx.update(approvalChainInstances).set({
      status: "approved",
      completedAt: new Date(),
    }).where(eq(approvalChainInstances.id, instance.id));
    return { isChain: true, final: true, nextTaskId: null, instanceId: instance.id, status: "approved" };
  }

  const [nextTask] = await tx.insert(approvalTasks).values({
    organizationId: task.organizationId,
    title: task.title,
    detail: task.detail,
    approver: next.approver,
    dueLabel: next.dueLabel ?? task.dueLabel,
    priority: next.priority ?? task.priority,
    approvalChainInstanceId: instance.id,
    approvalChainStepIndex: nextIndex,
  }).returning();

  await tx.insert(approvalChainInstanceSteps).values({
    organizationId: task.organizationId,
    instanceId: instance.id,
    stepIndex: nextIndex,
    label: next.label,
    approver: next.approver,
    status: "pending",
    approvalTaskId: nextTask.id,
  });

  await tx.update(approvalChainInstances).set({
    currentStepIndex: nextIndex,
  }).where(eq(approvalChainInstances.id, instance.id));

  return {
    isChain: true,
    final: false,
    nextTaskId: nextTask.id,
    instanceId: instance.id,
    status: "pending",
  };
}

export async function advanceApprovalChainAfterDecision(input: {
  taskId: number;
  decision: "Approved" | "Declined";
  decidedBy: string;
}) {
  return db.transaction((tx) => advanceApprovalChainAfterDecisionTx(tx, input));
}

export async function listApprovalChainPolicies(organizationId: number) {
  return db.select().from(approvalChainPolicies)
    .where(eq(approvalChainPolicies.organizationId, organizationId))
    .orderBy(asc(approvalChainPolicies.code));
}
