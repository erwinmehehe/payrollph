import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, employees, hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps, positionAssignments, positions, workerEffectiveChanges } from "@/db/schema";
import { canDecide } from "@/lib/delegation";
import { cancelHcmBusinessProcessForSourceTx, startHcmBusinessProcessTx } from "@/lib/hcm-business-process";
import { effectiveHcmSourceDrift } from "@/lib/hcm-effective-source-integrity";
import { hcmManilaDay } from "@/lib/hcm-people-intelligence";
import { assertCorrectableEmploymentChange, correctionDate, correctionFingerprint, correctionNote, HCM_CORRECTION_RETURNED } from "@/lib/hcm-effective-correction-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { organizationId: number; changeId: number; userId: number; name: string };

async function lockSource(tx: Tx, input: Actor) {
  // Same authority as normal advancement: serialize on the process first.
  const [instance] = await tx.select().from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, input.organizationId),
    eq(hcmBusinessProcessInstances.sourceType, "worker_effective_change"),
    eq(hcmBusinessProcessInstances.sourceKey, String(input.changeId)),
  )).for("update");
  const [change] = await tx.select().from(workerEffectiveChanges).where(and(
    eq(workerEffectiveChanges.organizationId, input.organizationId), eq(workerEffectiveChanges.id, input.changeId),
  )).for("update");
  if (!instance || !change || instance.employeeId !== change.employeeId || instance.processType !== "change_job") throw new Error("Correction source not found.");
  const [worker] = await tx.select({ id: employees.id }).from(employees).where(and(
    eq(employees.id, change.employeeId), eq(employees.organizationId, input.organizationId),
  )).for("share");
  if (!worker) throw new Error("Correction worker does not belong to this employer.");
  assertCorrectableEmploymentChange(change);
  return { instance, change };
}

export async function returnEffectiveChangeForCorrection(input: Actor & { note: unknown }) {
  const note = correctionNote(input.note);
  return db.transaction(async tx => {
    const { instance, change } = await lockSource(tx, input);
    if (change.status !== "pending_approval" || instance.status !== "in_progress") throw new Error("Only an active pending change can be returned.");
    if (!instance.initiatedByUserId || instance.initiatedByUserId !== change.requestedByUserId
      || instance.initiatedByUserId === input.userId) throw new Error("Maker-checker control: the requester cannot return their own change.");
    const [step] = await tx.select().from(hcmBusinessProcessInstanceSteps).where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, input.organizationId),
      eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id),
      eq(hcmBusinessProcessInstanceSteps.stepIndex, instance.currentStepIndex),
      eq(hcmBusinessProcessInstanceSteps.status, "pending"),
    )).for("update");
    if (!step || !["approval", "review"].includes(step.stepType)
      || !(await canDecide(input.organizationId, step.assignee, input.name, input.userId)).permitted) {
      throw new Error("Only the assigned current reviewer or approver can return this change.");
    }
    const allSteps = await tx.select().from(hcmBusinessProcessInstanceSteps).where(eq(hcmBusinessProcessInstanceSteps.instanceId, instance.id));
    if (allSteps.some(row => row.organizationId !== input.organizationId)) throw new Error("Process step employer mismatch.");
    const taskIds = allSteps.filter(row => row.status === "pending" && row.approvalTaskId !== null).map(row => row.approvalTaskId!);
    if (taskIds.length) {
      const tasks = await tx.select().from(approvalTasks).where(inArray(approvalTasks.id, taskIds));
      if (tasks.length !== taskIds.length || tasks.some(row => row.organizationId !== input.organizationId || row.status !== "Pending")) {
        throw new Error("Process approval authority changed or belongs to another employer.");
      }
    }
    // Terminate the OLD approval run. Completed steps remain historical;
    // pending tasks/waiting steps are cancelled, never recycled on resubmit.
    await cancelHcmBusinessProcessForSourceTx(tx, { organizationId: input.organizationId,
      sourceType: "worker_effective_change", sourceKey: String(change.id), actorUserId: input.userId, actorName: input.name });
    const [returned] = await tx.update(workerEffectiveChanges).set({ status: HCM_CORRECTION_RETURNED, updatedAt: new Date() })
      .where(and(eq(workerEffectiveChanges.id, change.id), eq(workerEffectiveChanges.organizationId, input.organizationId), eq(workerEffectiveChanges.status, "pending_approval"))).returning();
    if (!returned) throw new Error("Correction source changed concurrently.");
    await tx.insert(auditEvents).values({ organizationId: input.organizationId, actor: input.name,
      action: "HCM change returned for correction", resource: `Effective change #${change.id}`,
      metadata: { effectiveChangeId: change.id, businessProcessInstanceId: instance.id, stepId: step.id,
        actorUserId: input.userId, requesterUserId: change.requestedByUserId, note,
        originalSnapshotSha256: correctionFingerprint({ from: change.fromSnapshot, to: change.toSnapshot }) } });
    return { change: returned, previousProcessId: instance.id };
  });
}

export async function resubmitEffectiveChangeCorrection(input: Actor & { reason: unknown; effectiveDate: unknown }) {
  const reason = correctionNote(input.reason);
  if (reason.length > 240) throw new Error("The corrected request reason must be at most 240 characters.");
  const effectiveDate = correctionDate(input.effectiveDate, hcmManilaDay(new Date()));
  return db.transaction(async tx => {
    const { instance, change } = await lockSource(tx, input);
    if (change.status !== HCM_CORRECTION_RETURNED || instance.status !== "cancelled"
      || change.requestedByUserId !== input.userId || instance.initiatedByUserId !== input.userId) {
      throw new Error("Only the original requester can resubmit a returned change.");
    }
    const returns = await tx.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, input.organizationId), eq(auditEvents.action, "HCM change returned for correction"),
      sql`${auditEvents.metadata}->>'effectiveChangeId' = ${String(change.id)}`,
    )).limit(2);
    const receipt = returns[0]?.metadata as Record<string, unknown> | undefined;
    if (returns.length !== 1 || receipt?.businessProcessInstanceId !== instance.id
      || receipt.requesterUserId !== input.userId || !Number.isSafeInteger(receipt.actorUserId)
      || receipt.actorUserId === input.userId
      || receipt.originalSnapshotSha256 !== correctionFingerprint({ from: change.fromSnapshot, to: change.toSnapshot })) {
      throw new Error("The original independently returned source receipt cannot be verified.");
    }
    const prior = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.organizationId, input.organizationId), eq(auditEvents.action, "HCM corrected change resubmitted"),
      sql`${auditEvents.metadata}->>'previousChangeId' = ${String(change.id)}`,
    )).limit(1);
    if (prior.length) throw new Error("This returned change already has a resubmission.");
    if (reason === change.reason && effectiveDate === change.effectiveDate) throw new Error("Correct the reason or effective date before resubmitting.");
    const [worker] = await tx.select().from(employees).where(and(eq(employees.id, change.employeeId), eq(employees.organizationId, input.organizationId))).for("update");
    if (!worker || !["Active", "On leave"].includes(worker.status)) throw new Error("Worker is no longer eligible for this correction.");
    const assignments = await tx.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, input.organizationId), eq(positionAssignments.employeeId, worker.id),
      eq(positionAssignments.assignmentType, "primary"), isNull(positionAssignments.effectiveUntil),
    )).for("share");
    if (assignments.length > 1) throw new Error("Ambiguous current position assignment.");
    const assignment = assignments[0] ?? null;
    const [position] = assignment ? await tx.select().from(positions).where(and(
      eq(positions.id, assignment.positionId), eq(positions.organizationId, input.organizationId),
    )).for("share") : [];
    const drift = effectiveHcmSourceDrift(change.fromSnapshot, { employee: worker, assignment, position: position ?? null });
    if (drift) throw new Error("Worker source changed; submit a fresh independently validated request instead.");
    // Immutable new source ID + fresh policy/step snapshot. No approval fields,
    // applied events, completion times or prior task IDs are copied.
    const [created] = await tx.insert(workerEffectiveChanges).values({ organizationId: input.organizationId,
      employeeId: worker.id, changeType: change.changeType, movementType: change.movementType,
      effectiveDate, reason, status: "pending_approval", targetEmploymentType: change.targetEmploymentType,
      fromSnapshot: change.fromSnapshot, toSnapshot: { ...(change.toSnapshot as Record<string, unknown>), correctionOfChangeId: change.id },
      requestedByUserId: input.userId, requestedBy: input.name }).returning();
    const process = await startHcmBusinessProcessTx(tx, { organizationId: input.organizationId,
      sourceType: "worker_effective_change", sourceKey: String(created.id), processType: "change_job",
      employeeId: worker.id, employeeLabel: `${worker.firstName} ${worker.lastName}`,
      supervisoryOrgUnitId: instance.supervisoryOrgUnitId, effectiveDate,
      initiatedByUserId: input.userId, initiatedByName: input.name,
      sourceEvidence: { previousChangeId: change.id, previousProcessId: instance.id,
        originalSnapshotSha256: correctionFingerprint({ from: change.fromSnapshot, to: change.toSnapshot }) } });
    await tx.insert(auditEvents).values({ organizationId: input.organizationId, actor: input.name,
      action: "HCM corrected change resubmitted", resource: `Effective change #${created.id}`,
      metadata: { previousChangeId: change.id, previousProcessId: instance.id, effectiveChangeId: created.id,
        businessProcessInstanceId: process.id, requesterUserId: input.userId, reason, effectiveDate,
        originalSnapshotSha256: correctionFingerprint({ from: change.fromSnapshot, to: change.toSnapshot }) } });
    return { change: created, businessProcess: { id: process.id, status: process.status } };
  });
}
