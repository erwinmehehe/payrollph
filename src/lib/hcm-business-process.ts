import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  compensationProposals,
  hcmBusinessProcessDefinitions,
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
  jobRequisitions,
  orgUnits,
  positionAssignments,
  positions,
  workerEffectiveChanges,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { applyWorkerEffectiveChange, philippineBusinessDate } from "@/lib/hcm-effective-changes";
import { positionControlFingerprint, positionEvidenceFromDefinition } from "@/lib/hcm-position-business-process";

export const HCM_BUSINESS_PROCESS_TYPES = [
  "change_job",
  "transfer",
  "promotion",
  "compensation_change",
  "hire",
  "termination",
  "create_position",
  "close_position",
] as const;

export type HcmBusinessProcessType = (typeof HCM_BUSINESS_PROCESS_TYPES)[number];
export type HcmBusinessProcessStepType = "approval" | "review" | "to_do";

export type HcmBusinessProcessStepDefinition = {
  type: HcmBusinessProcessStepType;
  label: string;
  assignee: string;
  dueDays?: number;
  priority?: "Low" | "Normal" | "High";
};

export type HcmBusinessProcessDefinitionLike = {
  id?: number | null;
  code: string;
  name: string;
  processType: string;
  supervisoryOrgUnitId?: number | null;
  version: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  steps: unknown;
};

export type SupervisoryOrgNode = {
  id: number;
  parentId: number | null;
  type: string;
};

type HcmTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function processTypeForMovement(movementType: string): HcmBusinessProcessType {
  if (movementType === "promotion") return "promotion";
  if (movementType === "transfer" || movementType === "org_change" || movementType === "legal_employer_change") {
    return "transfer";
  }
  return "change_job";
}

export function validateHcmBusinessProcessSteps(value: unknown): HcmBusinessProcessStepDefinition[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const result: HcmBusinessProcessStepDefinition[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const type = String(row.type ?? "").trim() as HcmBusinessProcessStepType;
    const label = String(row.label ?? "").trim();
    const assignee = String(row.assignee ?? "").trim();
    const dueDays = row.dueDays == null || row.dueDays === "" ? 3 : Number(row.dueDays);
    const priorityRaw = String(row.priority ?? "Normal").trim();
    const priority = (["Low", "Normal", "High"].includes(priorityRaw) ? priorityRaw : "Normal") as HcmBusinessProcessStepDefinition["priority"];

    if (!["approval", "review", "to_do"].includes(type)) return null;
    if (!label || label.length > 120 || !assignee || assignee.length > 120) return null;
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 90) return null;

    result.push({
      type,
      label,
      assignee,
      dueDays,
      priority,
    });
  }

  return result;
}

export function supervisoryOrgPath(
  startId: number | null | undefined,
  units: SupervisoryOrgNode[],
) {
  if (!startId) return [] as number[];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const path: number[] = [];
  const seen = new Set<number>();
  let current: number | null = startId;

  while (current != null) {
    if (seen.has(current)) throw new Error("Supervisory organization hierarchy contains a cycle.");
    seen.add(current);
    const unit = byId.get(current);
    if (!unit || unit.type !== "supervisory") break;
    path.push(unit.id);
    current = unit.parentId;
  }

  return path;
}

export function chooseHcmBusinessProcessDefinition(
  definitions: HcmBusinessProcessDefinitionLike[],
  units: SupervisoryOrgNode[],
  input: {
    processType: HcmBusinessProcessType;
    supervisoryOrgUnitId?: number | null;
    effectiveDate: string;
  },
) {
  if (!isoDate(input.effectiveDate)) throw new Error("Business-process effective date must be YYYY-MM-DD.");
  const path = supervisoryOrgPath(input.supervisoryOrgUnitId ?? null, units);
  const rank = new Map(path.map((id, index) => [id, index]));

  const eligible = definitions.filter((definition) => {
    if (definition.processType !== input.processType) return false;
    if (definition.effectiveFrom > input.effectiveDate) return false;
    if (definition.effectiveUntil && definition.effectiveUntil < input.effectiveDate) return false;
    if (definition.supervisoryOrgUnitId == null) return true;
    return rank.has(definition.supervisoryOrgUnitId);
  });

  eligible.sort((a, b) => {
    const scopeA = a.supervisoryOrgUnitId == null ? Number.MAX_SAFE_INTEGER : rank.get(a.supervisoryOrgUnitId) ?? Number.MAX_SAFE_INTEGER;
    const scopeB = b.supervisoryOrgUnitId == null ? Number.MAX_SAFE_INTEGER : rank.get(b.supervisoryOrgUnitId) ?? Number.MAX_SAFE_INTEGER;
    if (scopeA !== scopeB) return scopeA - scopeB;
    if (a.version !== b.version) return b.version - a.version;
    return b.effectiveFrom.localeCompare(a.effectiveFrom);
  });

  return eligible[0] ?? null;
}

function fallbackDefinition(processType: HcmBusinessProcessType, effectiveDate: string): HcmBusinessProcessDefinitionLike {
  return {
    id: null,
    code: `system-${processType}-default`,
    name: ({
      change_job: "Enterprise change job review",
      transfer: "Enterprise transfer review",
      promotion: "Enterprise promotion review",
      compensation_change: "Enterprise compensation review",
      hire: "Enterprise hire review",
      termination: "Enterprise termination review",
      create_position: "Enterprise position creation review",
      close_position: "Enterprise position closure review",
    } satisfies Record<HcmBusinessProcessType, string>)[processType],
    processType,
    supervisoryOrgUnitId: null,
    version: 1,
    effectiveFrom: effectiveDate,
    effectiveUntil: null,
    steps: [
      { type: "approval", label: "People review", assignee: "role:hr", dueDays: 2, priority: "High" },
      { type: "approval", label: "Executive approval", assignee: "role:owner", dueDays: 2, priority: "High" },
    ] satisfies HcmBusinessProcessStepDefinition[],
  };
}

function stepDueAt(dueDays: number | undefined, now = new Date()) {
  if (!Number.isInteger(dueDays ?? 3) || (dueDays ?? 3) < 0 || (dueDays ?? 3) > 90) {
    throw new Error("Invalid HCM step due-day policy.");
  }
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() + (dueDays ?? 3));
  return value;
}

async function activateStepTx(
  tx: HcmTx,
  input: {
    instanceId: number;
    organizationId: number;
    stepIndex: number;
    processName: string;
    sourceKey: string;
    employeeLabel: string;
  },
) {
  const [step] = await tx.select().from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, input.instanceId),
    eq(hcmBusinessProcessInstanceSteps.stepIndex, input.stepIndex),
  )).limit(1);
  if (!step) throw new Error("Business-process step is missing.");

  const [process] = await tx.select({ definitionSnapshot: hcmBusinessProcessInstances.definitionSnapshot })
    .from(hcmBusinessProcessInstances).where(and(
      eq(hcmBusinessProcessInstances.id, input.instanceId),
      eq(hcmBusinessProcessInstances.organizationId, input.organizationId),
    )).limit(1);
  const frozen = process?.definitionSnapshot;
  const snapshotSteps = frozen && typeof frozen === "object" && !Array.isArray(frozen)
    ? validateHcmBusinessProcessSteps((frozen as Record<string, unknown>).steps)
    : null;
  const frozenStep = snapshotSteps?.[input.stepIndex];
  if (!frozenStep) throw new Error("HCM process step policy is missing or invalid.");

  const [activated] = await tx.update(hcmBusinessProcessInstanceSteps).set({
    status: "pending",
    dueAt: stepDueAt(frozenStep.dueDays),
  }).where(and(
    eq(hcmBusinessProcessInstanceSteps.id, step.id),
    eq(hcmBusinessProcessInstanceSteps.status, "waiting"),
  )).returning();
  const current = activated ?? step;
  if (current.status !== "pending") {
    throw new Error("Business-process step is not available for activation.");
  }

  if (current.stepType !== "approval") return { step: current, approvalTask: null };

  const [existingTask] = current.approvalTaskId
    ? await tx.select().from(approvalTasks).where(eq(approvalTasks.id, current.approvalTaskId)).limit(1)
    : [];
  if (existingTask) return { step: current, approvalTask: existingTask };

  const [task] = await tx.insert(approvalTasks).values({
    organizationId: input.organizationId,
    title: `${input.processName} · ${input.employeeLabel}`.slice(0, 180),
    detail: `HCM process #${input.instanceId} · source #${input.sourceKey} · ${current.label}`.slice(0, 240),
    approver: current.assignee,
    dueLabel: current.dueAt
      ? `Due ${new Date(current.dueAt).toISOString().slice(0, 10)}`
      : "Review required",
    priority: current.priority,
  }).returning();

  const [linked] = await tx.update(hcmBusinessProcessInstanceSteps).set({
    approvalTaskId: task.id,
  }).where(eq(hcmBusinessProcessInstanceSteps.id, current.id)).returning();

  return { step: linked ?? current, approvalTask: task };
}

export async function startHcmBusinessProcessTx(
  tx: HcmTx,
  input: {
    organizationId: number;
    processType: HcmBusinessProcessType;
    sourceType: string;
    sourceKey: string;
    employeeId?: number | null;
    employeeLabel: string;
    supervisoryOrgUnitId?: number | null;
    effectiveDate: string;
    initiatedByUserId?: number | null;
    initiatedByName: string;
    sourceEvidence?: Record<string, unknown>;
  },
) {
  const [existing] = await tx.select().from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, input.organizationId),
    eq(hcmBusinessProcessInstances.sourceType, input.sourceType),
    eq(hcmBusinessProcessInstances.sourceKey, input.sourceKey),
  )).limit(1);
  if (existing) return existing;

  const [definitionRows, unitRows] = await Promise.all([
    tx.select().from(hcmBusinessProcessDefinitions).where(and(
      eq(hcmBusinessProcessDefinitions.organizationId, input.organizationId),
      eq(hcmBusinessProcessDefinitions.processType, input.processType),
    )),
    tx.select({
      id: orgUnits.id,
      parentId: orgUnits.parentId,
      type: orgUnits.type,
    }).from(orgUnits).where(eq(orgUnits.organizationId, input.organizationId)),
  ]);

  const normalizedDefinitions = definitionRows.map((row) => ({
    ...row,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
  }));
  const configuredScopePath = supervisoryOrgPath(input.supervisoryOrgUnitId ?? null, unitRows);
  const matchingScopeHasPolicy = normalizedDefinitions.some((row) =>
    row.supervisoryOrgUnitId == null || configuredScopePath.includes(row.supervisoryOrgUnitId)
  );
  const applicable = chooseHcmBusinessProcessDefinition(
    normalizedDefinitions.filter((row) => row.active),
    unitRows,
    {
      processType: input.processType,
      supervisoryOrgUnitId: input.supervisoryOrgUnitId,
      effectiveDate: input.effectiveDate,
    },
  );
  // An explicitly governed scope cannot bypass its policy by deactivating all
  // versions or choosing a date that lacks an effective definition.
  if (!applicable && matchingScopeHasPolicy) {
    throw new Error(
      "Business-process policy exists for this supervisory scope, but no active effective version covers the change date.",
    );
  }
  const selected = applicable ?? fallbackDefinition(input.processType, input.effectiveDate);

  const steps = validateHcmBusinessProcessSteps(selected.steps);
  if (!steps) throw new Error(`Business-process definition "${selected.code}" has invalid steps.`);

  const [instance] = await tx.insert(hcmBusinessProcessInstances).values({
    organizationId: input.organizationId,
    definitionId: selected.id ?? null,
    definitionCode: selected.code,
    definitionVersion: selected.version,
    processType: input.processType,
    sourceType: input.sourceType.slice(0, 48),
    sourceKey: input.sourceKey.slice(0, 160),
    employeeId: input.employeeId ?? null,
    supervisoryOrgUnitId: input.supervisoryOrgUnitId ?? null,
    effectiveDate: input.effectiveDate,
    status: "in_progress",
    currentStepIndex: 0,
    definitionSnapshot: {
      code: selected.code,
      name: selected.name,
      processType: selected.processType,
      supervisoryOrgUnitId: selected.supervisoryOrgUnitId ?? null,
      version: selected.version,
      effectiveFrom: selected.effectiveFrom,
      effectiveUntil: selected.effectiveUntil ?? null,
      steps,
      sourceEvidence: input.sourceEvidence ?? null,
    },
    initiatedByUserId: input.initiatedByUserId ?? null,
    initiatedByName: input.initiatedByName.slice(0, 120),
  }).returning();

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    await tx.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: input.organizationId,
      instanceId: instance.id,
      stepIndex: index,
      stepType: step.type,
      label: step.label,
      assignee: step.assignee,
      priority: step.priority ?? "Normal",
      status: "waiting",
      dueAt: null, // Starts when activated, not when the instance is initiated.
    });
  }

  await activateStepTx(tx, {
    instanceId: instance.id,
    organizationId: input.organizationId,
    stepIndex: 0,
    processName: selected.name,
    sourceKey: input.sourceKey,
    employeeLabel: input.employeeLabel,
  });

  return instance;
}

async function advanceAfterStepTx(
  tx: HcmTx,
  input: {
    instanceId: number;
    stepIndex: number;
    outcome: "completed" | "declined";
    actorUserId?: number | null;
    actorName: string;
    note?: string | null;
  },
) {
  await tx.execute(sql`
    select id from hcm_business_process_instances
    where id = ${input.instanceId}
    for update
  `);

  const [instance] = await tx.select().from(hcmBusinessProcessInstances)
    .where(eq(hcmBusinessProcessInstances.id, input.instanceId))
    .limit(1);
  if (!instance) throw new Error("Business-process instance no longer exists.");
  if (instance.status !== "in_progress") {
    return {
      isHcmProcess: true,
      final: true,
      status: instance.status,
      instanceId: instance.id,
      nextTaskId: null as number | null,
      sourceType: instance.sourceType,
      sourceKey: instance.sourceKey,
    };
  }
  if (instance.currentStepIndex !== input.stepIndex) {
    throw new Error("Business process already advanced to another step.");
  }

  const [step] = await tx.update(hcmBusinessProcessInstanceSteps).set({
    status: input.outcome,
    completedByUserId: input.actorUserId ?? null,
    completedByName: input.actorName.slice(0, 120),
    completedAt: new Date(),
    decisionNote: input.note?.slice(0, 2000) ?? null,
  }).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id),
    eq(hcmBusinessProcessInstanceSteps.stepIndex, input.stepIndex),
    eq(hcmBusinessProcessInstanceSteps.status, "pending"),
  )).returning();
  if (!step) throw new Error("Business-process step was already completed.");

  if (input.outcome === "declined") {
    await tx.update(hcmBusinessProcessInstanceSteps).set({ status: "cancelled" }).where(and(
      eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id),
      eq(hcmBusinessProcessInstanceSteps.status, "waiting"),
    ));
    await tx.update(hcmBusinessProcessInstances).set({
      status: "declined",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(hcmBusinessProcessInstances.id, instance.id));
    return {
      isHcmProcess: true,
      final: true,
      status: "declined",
      instanceId: instance.id,
      nextTaskId: null as number | null,
      sourceType: instance.sourceType,
      sourceKey: instance.sourceKey,
    };
  }

  const [next] = await tx.select().from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id),
    eq(hcmBusinessProcessInstanceSteps.stepIndex, input.stepIndex + 1),
  )).limit(1);

  if (!next) {
    await tx.update(hcmBusinessProcessInstances).set({
      status: "approved",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(hcmBusinessProcessInstances.id, instance.id));
    return {
      isHcmProcess: true,
      final: true,
      status: "approved",
      instanceId: instance.id,
      nextTaskId: null as number | null,
      sourceType: instance.sourceType,
      sourceKey: instance.sourceKey,
    };
  }

  await tx.update(hcmBusinessProcessInstances).set({
    currentStepIndex: next.stepIndex,
    updatedAt: new Date(),
  }).where(eq(hcmBusinessProcessInstances.id, instance.id));

  const snapshot = instance.definitionSnapshot && typeof instance.definitionSnapshot === "object" && !Array.isArray(instance.definitionSnapshot)
    ? instance.definitionSnapshot as Record<string, unknown>
    : {};
  const processName = typeof snapshot.name === "string" ? snapshot.name : instance.processType;
  const employeeLabel = instance.employeeId ? `Employee #${instance.employeeId}` : "HCM transaction";
  const activated = await activateStepTx(tx, {
    instanceId: instance.id,
    organizationId: instance.organizationId,
    stepIndex: next.stepIndex,
    processName,
    sourceKey: instance.sourceKey,
    employeeLabel,
  });

  return {
    isHcmProcess: true,
    final: false,
    status: "in_progress",
    instanceId: instance.id,
    nextTaskId: activated.approvalTask?.id ?? null,
    sourceType: instance.sourceType,
    sourceKey: instance.sourceKey,
  };
}

export async function advanceHcmBusinessProcessAfterApprovalTx(
  tx: HcmTx,
  input: {
    taskId: number;
    decision: "Approved" | "Declined";
    actorUserId?: number | null;
    actorName: string;
  },
) {
  const [step] = await tx.select().from(hcmBusinessProcessInstanceSteps).where(eq(
    hcmBusinessProcessInstanceSteps.approvalTaskId,
    input.taskId,
  )).limit(1);
  if (!step) {
    return {
      isHcmProcess: false,
      final: false,
      status: null,
      instanceId: null,
      nextTaskId: null,
      sourceType: null,
      sourceKey: null,
    };
  }
  if (step.stepType !== "approval") throw new Error("Only approval steps may be linked to approval tasks.");

  return advanceAfterStepTx(tx, {
    instanceId: step.instanceId,
    stepIndex: step.stepIndex,
    outcome: input.decision === "Approved" ? "completed" : "declined",
    actorUserId: input.actorUserId,
    actorName: input.actorName,
  });
}

export async function completeHcmBusinessProcessWorkItemTx(
  tx: HcmTx,
  input: {
    stepId: number;
    outcome: "completed" | "declined";
    actorUserId?: number | null;
    actorName: string;
    note?: string | null;
  },
) {
  const [step] = await tx.select().from(hcmBusinessProcessInstanceSteps)
    .where(eq(hcmBusinessProcessInstanceSteps.id, input.stepId))
    .limit(1);
  if (!step) throw new Error("Business-process work item not found.");
  if (step.stepType === "approval") throw new Error("Approval work items must use the approval decision endpoint.");
  if (step.stepType === "to_do" && input.outcome === "declined") {
    throw new Error("To-do steps can only be completed.");
  }

  return advanceAfterStepTx(tx, {
    instanceId: step.instanceId,
    stepIndex: step.stepIndex,
    outcome: input.outcome,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    note: input.note,
  });
}

export async function cancelHcmBusinessProcessForSourceTx(
  tx: HcmTx,
  input: {
    organizationId: number;
    sourceType: string;
    sourceKey: string;
    actorUserId?: number | null;
    actorName: string;
  },
) {
  const [instance] = await tx.select().from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, input.organizationId),
    eq(hcmBusinessProcessInstances.sourceType, input.sourceType),
    eq(hcmBusinessProcessInstances.sourceKey, input.sourceKey),
  )).limit(1);
  if (!instance) return null;
  if (instance.status !== "in_progress") return instance;

  await tx.execute(sql`
    select id from hcm_business_process_instances
    where id = ${instance.id}
    for update
  `);

  const [lockedInstance] = await tx.select().from(hcmBusinessProcessInstances)
    .where(eq(hcmBusinessProcessInstances.id, instance.id))
    .limit(1);
  if (!lockedInstance) return null;
  if (lockedInstance.status !== "in_progress") return lockedInstance;

  const pendingSteps = await tx.select({
    approvalTaskId: hcmBusinessProcessInstanceSteps.approvalTaskId,
  }).from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, lockedInstance.id),
    eq(hcmBusinessProcessInstanceSteps.status, "pending"),
  ));
  const pendingTaskIds = pendingSteps
    .map((row) => row.approvalTaskId)
    .filter((id): id is number => Number.isInteger(id));

  if (pendingTaskIds.length > 0) {
    await tx.update(approvalTasks).set({
      status: "Cancelled",
      decidedBy: input.actorName.slice(0, 120),
      decidedAt: new Date(),
    }).where(inArray(approvalTasks.id, pendingTaskIds));
  }

  await tx.update(hcmBusinessProcessInstanceSteps).set({
    status: "cancelled",
    completedByUserId: input.actorUserId ?? null,
    completedByName: input.actorName.slice(0, 120),
    completedAt: new Date(),
  }).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, lockedInstance.id),
    inArray(hcmBusinessProcessInstanceSteps.status, ["pending", "waiting"]),
  ));

  const [cancelled] = await tx.update(hcmBusinessProcessInstances).set({
    status: "cancelled",
    cancelledByUserId: input.actorUserId ?? null,
    cancelledByName: input.actorName.slice(0, 120),
    cancelledAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(hcmBusinessProcessInstances.id, lockedInstance.id),
    eq(hcmBusinessProcessInstances.status, "in_progress"),
  )).returning();

  return cancelled ?? lockedInstance;
}

export async function findHcmBusinessProcessForSource(input: {
  organizationId: number;
  sourceType: string;
  sourceKey: string;
}) {
  const [row] = await db.select().from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, input.organizationId),
    eq(hcmBusinessProcessInstances.sourceType, input.sourceType),
    eq(hcmBusinessProcessInstances.sourceKey, input.sourceKey),
  )).limit(1);
  return row ?? null;
}

/**
 * Apply an approved position decision to the authoritative position ledger.
 * Approval itself never creates a recruitable vacancy or closes a position:
 * this adapter is the only BP-owned mutation path and rechecks all live state.
 * Position executions from a published workforce plan use their own governed
 * MFA/approval path and are not retaken through this workflow.
 */
async function finalizePositionBusinessProcessSource(
  instance: typeof hcmBusinessProcessInstances.$inferSelect,
  input: { actorUserId?: number | null; actorName: string },
) {
  if (instance.status === "declined") {
    return { instance, sourceFinalized: true, sourceStatus: "declined" as const };
  }
  if (instance.status === "applied") {
    return { instance, sourceFinalized: true, sourceStatus: "applied" as const };
  }
  if (instance.status !== "approved") return { instance, sourceFinalized: false };

  const evidence = positionEvidenceFromDefinition(instance.definitionSnapshot);
  const creation = instance.sourceType === "position_creation";
  if (!evidence || evidence.organizationId !== instance.organizationId
    || !instance.sourceKey.startsWith(`${evidence.positionId}:`)
    || (creation && (instance.processType !== "create_position" || evidence.expectedStatus !== "planned"))
    || (!creation && instance.processType !== "close_position")) {
    throw new Error("Position business-process source evidence does not match the approved request.");
  }
  // Closing a planned position is allowed; approvals and recruitment must
  // still be rechecked against the current authoritative lifecycle records.
  const nextStatus = creation ? "approved" : "closed";
  let changed: typeof positions.$inferSelect;
  try {
    changed = await db.transaction(async (tx) => {
      // The same advisory lock is used by workforce planning, recruitment and
      // incumbent assignment. No approved source can race a live occupant.
      await tx.execute(sql`select pg_advisory_xact_lock(4102, ${evidence.positionId})`);

      const [current] = await tx.select().from(positions).where(and(
        eq(positions.id, evidence.positionId),
        eq(positions.organizationId, instance.organizationId),
      )).limit(1);
      if (!current || current.status !== evidence.expectedStatus
        || positionControlFingerprint(current) !== evidence.fingerprint) {
        throw new Error("Position changed since approval request; submit a fresh reviewed position decision.");
      }
      if (!creation && !["planned", "approved", "open", "frozen"].includes(current.status)) {
        throw new Error("An occupied or already closed position cannot be closed through HCM approval.");
      }

      const [activeAssignment] = await tx.select({ id: positionAssignments.id })
        .from(positionAssignments).where(and(
          eq(positionAssignments.organizationId, instance.organizationId),
          eq(positionAssignments.positionId, evidence.positionId),
          isNull(positionAssignments.effectiveUntil),
        )).limit(1);
      if (activeAssignment) {
        throw new Error("An active incumbent must be moved or separated before the position lifecycle can change.");
      }

      const requisitions = await tx.select({
        id: jobRequisitions.id,
        status: jobRequisitions.status,
      }).from(jobRequisitions).where(and(
        eq(jobRequisitions.organizationId, instance.organizationId),
        eq(jobRequisitions.positionId, evidence.positionId),
      ));
      if (requisitions.some((row) => !["filled", "cancelled"].includes(row.status))) {
        throw new Error("Resolve the active requisition before approving or closing this position.");
      }

      const [updated] = await tx.update(positions).set({
        status: nextStatus,
        updatedAt: new Date(),
      }).where(and(
        eq(positions.id, evidence.positionId),
        eq(positions.organizationId, instance.organizationId),
        eq(positions.status, evidence.expectedStatus),
      )).returning();
      if (!updated) throw new Error("Position state changed before approval could be applied.");

      const [applied] = await tx.update(hcmBusinessProcessInstances).set({
        status: "applied",
        updatedAt: new Date(),
      }).where(and(
        eq(hcmBusinessProcessInstances.id, instance.id),
        eq(hcmBusinessProcessInstances.organizationId, instance.organizationId),
        eq(hcmBusinessProcessInstances.status, "approved"),
      )).returning();
      if (!applied) throw new Error("The business process changed before its position decision could be applied.");

      return updated;
    });
  } catch (error) {
    await db.update(hcmBusinessProcessInstances).set({
      status: "failed",
      updatedAt: new Date(),
    }).where(and(
      eq(hcmBusinessProcessInstances.id, instance.id),
      eq(hcmBusinessProcessInstances.organizationId, instance.organizationId),
      eq(hcmBusinessProcessInstances.status, "approved"),
    ));
    throw error;
  }

  await recordAuditEvent({
    organizationId: instance.organizationId,
    actor: input.actorName,
    action: creation ? "HCM position creation approved and applied" : "HCM position closure approved and applied",
    resource: changed.code,
    metadata: {
      businessProcessInstanceId: instance.id,
      positionId: changed.id,
      fromStatus: evidence.expectedStatus,
      toStatus: nextStatus,
      fingerprint: evidence.fingerprint,
      actorUserId: input.actorUserId ?? null,
    },
  });
  return { instance, sourceFinalized: true, sourceStatus: "applied" as const, position: changed };
}

export async function finalizeHcmBusinessProcessSource(input: {
  instanceId: number;
  actorUserId?: number | null;
  actorName: string;
}) {
  const [instance] = await db.select().from(hcmBusinessProcessInstances)
    .where(eq(hcmBusinessProcessInstances.id, input.instanceId))
    .limit(1);
  if (!instance) throw new Error("Business-process instance not found.");
  if (instance.sourceType === "position_creation" || instance.sourceType === "position_closure") {
    return finalizePositionBusinessProcessSource(instance, input);
  }
  if (instance.sourceType === "compensation_proposal") {
    const proposalId = Number(instance.sourceKey);
    if (!Number.isSafeInteger(proposalId) || proposalId <= 0
      || instance.processType !== "compensation_change") {
      throw new Error("Invalid compensation business-process source.");
    }
    if (instance.status === "declined") {
      // A rejected BP cannot leave an approvable pay recommendation behind.
      // No pay revision, payroll release, or money-bearing state is modified.
      const [declined] = await db.update(compensationProposals).set({
        status: "declined",
        updatedAt: new Date(),
      }).where(and(
        eq(compensationProposals.id, proposalId),
        eq(compensationProposals.organizationId, instance.organizationId),
        eq(compensationProposals.status, "proposed"),
      )).returning({ id: compensationProposals.id });
      if (declined) {
        await recordAuditEvent({
          organizationId: instance.organizationId,
          actor: input.actorName,
          action: "Compensation proposal declined through HCM business process",
          resource: `Proposal #${proposalId}`,
          metadata: { businessProcessInstanceId: instance.id, proposalId },
        });
      }
      return { instance, sourceFinalized: Boolean(declined), sourceStatus: "declined" as const };
    }
    // HR/manager approval only makes the proposal eligible for the separate
    // owner/finance approval; the HCM BP never schedules or applies salary.
    return { instance, sourceFinalized: false, sourceStatus: instance.status };
  }
  if (instance.sourceType !== "worker_effective_change") return { instance, sourceFinalized: false };

  const changeId = Number(instance.sourceKey);
  if (!Number.isInteger(changeId)) throw new Error("Business-process source key is not a valid HCM change id.");
  const [change] = await db.select().from(workerEffectiveChanges).where(and(
    eq(workerEffectiveChanges.id, changeId),
    eq(workerEffectiveChanges.organizationId, instance.organizationId),
  )).limit(1);
  if (!change) throw new Error("The effective-dated HCM change linked to this process no longer exists.");

  if (instance.status === "declined") {
    if (change.status === "pending_approval") {
      await db.update(workerEffectiveChanges).set({
        status: "declined",
        approvedByUserId: input.actorUserId ?? null,
        approvedBy: input.actorName,
        approvedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(workerEffectiveChanges.id, change.id),
        eq(workerEffectiveChanges.status, "pending_approval"),
      ));
    }
    await recordAuditEvent({
      organizationId: instance.organizationId,
      actor: input.actorName,
      action: "HCM business process declined",
      resource: `Effective change #${change.id}`,
      metadata: { businessProcessInstanceId: instance.id, processType: instance.processType },
    });
    return { instance, sourceFinalized: true, sourceStatus: "declined" as const };
  }

  if (instance.status !== "approved") {
    return { instance, sourceFinalized: false };
  }

  const scheduled = await db.transaction(async (tx) => {
    if (change.targetPositionId) {
      const [reserved] = await tx.update(positions).set({
        status: "reserved",
        updatedAt: new Date(),
      }).where(and(
        eq(positions.id, change.targetPositionId),
        eq(positions.organizationId, change.organizationId),
        eq(positions.status, "approved"),
      )).returning();
      if (!reserved) throw new Error("The target position is no longer an approved vacancy.");
    }

    const [row] = await tx.update(workerEffectiveChanges).set({
      status: "scheduled",
      approvedByUserId: input.actorUserId ?? null,
      approvedBy: input.actorName,
      approvedAt: new Date(),
      failure: null,
      updatedAt: new Date(),
    }).where(and(
      eq(workerEffectiveChanges.id, change.id),
      eq(workerEffectiveChanges.status, "pending_approval"),
    )).returning();

    if (!row) {
      const [current] = await tx.select().from(workerEffectiveChanges)
        .where(eq(workerEffectiveChanges.id, change.id))
        .limit(1);
      if (current?.status === "scheduled" || current?.status === "applied") return current;
      throw new Error("The HCM source changed before business-process completion.");
    }
    return row;
  });

  await recordAuditEvent({
    organizationId: scheduled.organizationId,
    actor: input.actorName,
    action: "HCM business process approved",
    resource: `Employee #${scheduled.employeeId}`,
    metadata: {
      businessProcessInstanceId: instance.id,
      effectiveChangeId: scheduled.id,
      processType: instance.processType,
      effectiveDate: scheduled.effectiveDate,
    },
  });

  if (String(scheduled.effectiveDate) > philippineBusinessDate()) {
    return { instance, sourceFinalized: true, sourceStatus: "scheduled" as const, change: scheduled };
  }

  try {
    const applied = await applyWorkerEffectiveChange(scheduled.id, {
      actor: input.actorName,
      actorUserId: input.actorUserId ?? null,
    });
    await db.update(hcmBusinessProcessInstances).set({
      status: "applied",
      updatedAt: new Date(),
    }).where(eq(hcmBusinessProcessInstances.id, instance.id));
    return { instance, sourceFinalized: true, sourceStatus: "applied" as const, change: scheduled, applied };
  } catch (error) {
    await db.update(hcmBusinessProcessInstances).set({
      status: "failed",
      updatedAt: new Date(),
    }).where(eq(hcmBusinessProcessInstances.id, instance.id));
    throw error;
  }
}

export async function supervisoryOrgForEffectiveChange(input: {
  organizationId: number;
  employeeId: number;
  targetPositionId?: number | null;
  targetSupervisoryOrgUnitId?: number | null;
}) {
  if (input.targetPositionId) {
    const [target] = await db.select({
      supervisoryOrgUnitId: positions.supervisoryOrgUnitId,
    }).from(positions).where(and(
      eq(positions.id, input.targetPositionId),
      eq(positions.organizationId, input.organizationId),
    )).limit(1);
    if (target) return target.supervisoryOrgUnitId;
  }
  if (input.targetSupervisoryOrgUnitId) return input.targetSupervisoryOrgUnitId;

  const [assignment] = await db.select({
    positionId: positions.id,
    supervisoryOrgUnitId: positions.supervisoryOrgUnitId,
  }).from(positionAssignments)
    .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
    .where(and(
      eq(positionAssignments.organizationId, input.organizationId),
      eq(positionAssignments.employeeId, input.employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
    ))
    .limit(1);
  return assignment?.supervisoryOrgUnitId ?? null;
}
