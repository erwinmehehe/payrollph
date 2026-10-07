import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dynamicWorkerGroups } from "@/db/schema";
import {
  DYNAMIC_WORKER_GROUP_FIELDS,
  DYNAMIC_WORKER_GROUP_OPERATORS,
  normalizeDynamicGroupCode,
  validDynamicWorkerGroupConditions,
  workerMatchesDynamicGroup,
  type DynamicWorkerGroupConditions,
} from "@/lib/dynamic-worker-group-conditions";
import {
  loadWorkerAttributeContexts,
  type WorkerAttributeContext,
} from "@/lib/worker-attribute-context";

export {
  DYNAMIC_WORKER_GROUP_FIELDS,
  DYNAMIC_WORKER_GROUP_OPERATORS,
  normalizeDynamicGroupCode,
  validDynamicWorkerGroupConditions,
  workerMatchesDynamicGroup,
};
export type { DynamicWorkerGroupConditions };

export async function listDynamicWorkerGroups(organizationId: number, activeOnly = false) {
  const where = activeOnly
    ? and(
        eq(dynamicWorkerGroups.organizationId, organizationId),
        eq(dynamicWorkerGroups.active, true),
      )
    : eq(dynamicWorkerGroups.organizationId, organizationId);
  return db.select().from(dynamicWorkerGroups)
    .where(where)
    .orderBy(asc(dynamicWorkerGroups.name), asc(dynamicWorkerGroups.id));
}

export async function resolveWorkerDynamicGroups(input: {
  organizationId: number;
  context: WorkerAttributeContext;
}) {
  const groups = await listDynamicWorkerGroups(input.organizationId, true);
  return groups.flatMap((group) => {
    if (!validDynamicWorkerGroupConditions(group.conditions)) return [];
    if (!workerMatchesDynamicGroup(group.conditions, input.context as unknown as Record<string, unknown>)) return [];
    return [{
      id: group.id,
      code: group.code,
      name: group.name,
      version: group.version,
    }];
  });
}

export async function previewDynamicWorkerGroup(input: {
  organizationId: number;
  conditions: DynamicWorkerGroupConditions;
  limit?: number;
}) {
  const contexts = await loadWorkerAttributeContexts({
    organizationId: input.organizationId,
  });
  const members = contexts.filter((context) =>
    workerMatchesDynamicGroup(input.conditions, context as unknown as Record<string, unknown>)
  );
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  return {
    totalWorkersEvaluated: contexts.length,
    memberCount: members.length,
    sampleMembers: members.slice(0, limit).map((member) => ({
      employeeId: member.employeeId,
      employeeNo: member.employeeNo,
      employeeName: member.employeeName,
      department: member.department,
      role: member.role,
      location: member.location,
      employmentType: member.employmentType,
      verifiedSkillCodes: member.verifiedSkillCodes,
      validCredentialCodes: member.validCredentialCodes,
    })),
  };
}
