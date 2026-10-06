import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmEmploymentDecisionManagerAttestations,
  hcmEmploymentTermDecisions,
  positionAssignments,
  positions,
} from "@/db/schema";

export const MANAGER_ATTESTATION_RECOMMENDATIONS = [
  "support",
  "do_not_support",
  "needs_more_review",
] as const;

export type ManagerAttestationRecommendation =
  (typeof MANAGER_ATTESTATION_RECOMMENDATIONS)[number];

export async function loadDecisionManagerContext(input: {
  organizationId: number;
  decisionId: number;
}) {
  const [decision] = await db.select().from(hcmEmploymentTermDecisions).where(and(
    eq(hcmEmploymentTermDecisions.id, input.decisionId),
    eq(hcmEmploymentTermDecisions.organizationId, input.organizationId),
  )).limit(1);
  if (!decision) return null;

  const [assignment] = await db.select({
    assignmentId: positionAssignments.id,
    assignmentEffectiveFrom: positionAssignments.effectiveFrom,
    positionId: positions.id,
    positionCode: positions.code,
    managerEmployeeId: positions.managerEmployeeId,
  }).from(positionAssignments)
    .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
    .where(and(
      eq(positionAssignments.organizationId, input.organizationId),
      eq(positionAssignments.employeeId, decision.employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
    ))
    .orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id))
    .limit(1);

  if (!assignment?.managerEmployeeId) {
    return { decision, assignment: null, manager: null };
  }

  const [manager] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
  }).from(employees).where(and(
    eq(employees.organizationId, input.organizationId),
    eq(employees.id, assignment.managerEmployeeId),
  )).limit(1);

  return {
    decision,
    assignment,
    manager: manager ?? null,
  };
}

export async function listDecisionManagerAttestations(input: {
  organizationId: number;
  decisionId: number;
}) {
  return db.select().from(hcmEmploymentDecisionManagerAttestations).where(and(
    eq(hcmEmploymentDecisionManagerAttestations.organizationId, input.organizationId),
    eq(hcmEmploymentDecisionManagerAttestations.decisionId, input.decisionId),
  )).orderBy(
    asc(hcmEmploymentDecisionManagerAttestations.createdAt),
    asc(hcmEmploymentDecisionManagerAttestations.id),
  );
}

export async function createDecisionManagerAttestation(input: {
  organizationId: number;
  decisionId: number;
  managerUserId: number;
  managerEmployeeId: number;
  managerName: string;
  recommendation: ManagerAttestationRecommendation;
  statement: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [decision] = await tx.select().from(hcmEmploymentTermDecisions).where(and(
      eq(hcmEmploymentTermDecisions.id, input.decisionId),
      eq(hcmEmploymentTermDecisions.organizationId, input.organizationId),
    )).limit(1);
    if (!decision) throw new Error("Employment-term decision not found.");
    if (decision.status !== "pending_approval") {
      throw new Error("Manager attestations are append-only while the decision is pending approval.");
    }

    const [assignment] = await tx.select({
      assignmentId: positionAssignments.id,
      assignmentEffectiveFrom: positionAssignments.effectiveFrom,
      positionId: positions.id,
      positionCode: positions.code,
      managerEmployeeId: positions.managerEmployeeId,
    }).from(positionAssignments)
      .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
      .where(and(
        eq(positionAssignments.organizationId, input.organizationId),
        eq(positionAssignments.employeeId, decision.employeeId),
        eq(positionAssignments.assignmentType, "primary"),
        isNull(positionAssignments.effectiveUntil),
      ))
      .orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id))
      .limit(1);

    if (!assignment?.managerEmployeeId) {
      throw new Error("This worker has no current manager on the active primary position assignment.");
    }
    if (assignment.managerEmployeeId !== input.managerEmployeeId) {
      throw new Error("The reporting line changed before the manager attestation was submitted. Refresh and try again.");
    }

    const [created] = await tx.insert(hcmEmploymentDecisionManagerAttestations).values({
      organizationId: input.organizationId,
      decisionId: decision.id,
      employeeId: decision.employeeId,
      workerPositionAssignmentId: assignment.assignmentId,
      workerPositionId: assignment.positionId,
      managerEmployeeId: input.managerEmployeeId,
      managerUserId: input.managerUserId,
      managerName: input.managerName,
      recommendation: input.recommendation,
      statement: input.statement,
      reportingLineSnapshot: {
        workerPositionAssignmentId: assignment.assignmentId,
        workerPositionId: assignment.positionId,
        workerPositionCode: assignment.positionCode,
        assignmentEffectiveFrom: String(assignment.assignmentEffectiveFrom),
        managerEmployeeId: input.managerEmployeeId,
      },
      createdAt: now,
    }).returning();

    return created;
  });
}

export function latestManagerAttestation<T extends {
  createdAt: Date;
  id: number;
}>(attestations: T[]) {
  return [...attestations].sort((left, right) => {
    const time = right.createdAt.getTime() - left.createdAt.getTime();
    return time || right.id - left.id;
  })[0] ?? null;
}
