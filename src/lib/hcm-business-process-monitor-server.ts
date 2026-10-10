import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps } from "@/db/schema";
import {
  HCM_BP_MONITOR_PAGE_SIZE, HCM_BP_MONITOR_STEP_LIMIT,
  bpMonitorCursorFor, projectBpMonitorInstance, projectBpMonitorStep,
  type BpMonitorCursor, type HcmBpMonitorFilter,
} from "@/lib/hcm-business-process-monitor-projection";
import type {
  BpMonitorDetailResponse, BpMonitorListResponse,
} from "@/lib/hcm-business-process-monitor-contract";

/** Called only after route-level tenant, role and deny-only permission checks. */
export async function loadBpMonitorList(
  organizationId: number,
  statusFilter: HcmBpMonitorFilter,
  cursor: BpMonitorCursor | null,
): Promise<BpMonitorListResponse> {
  const predicates = [eq(hcmBusinessProcessInstances.organizationId, organizationId)];
  if (statusFilter !== "all") predicates.push(eq(hcmBusinessProcessInstances.status, statusFilter));
  if (cursor) predicates.push(or(
    lt(hcmBusinessProcessInstances.initiatedAt, cursor.initiatedAt),
    and(
      eq(hcmBusinessProcessInstances.initiatedAt, cursor.initiatedAt),
      lt(hcmBusinessProcessInstances.id, cursor.id),
    ),
  )!);

  const rows = await db.select({
    id: hcmBusinessProcessInstances.id,
    definitionCode: hcmBusinessProcessInstances.definitionCode,
    definitionVersion: hcmBusinessProcessInstances.definitionVersion,
    processType: hcmBusinessProcessInstances.processType,
    sourceType: hcmBusinessProcessInstances.sourceType,
    status: hcmBusinessProcessInstances.status,
    currentStepIndex: hcmBusinessProcessInstances.currentStepIndex,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedAt: hcmBusinessProcessInstances.initiatedAt,
    completedAt: hcmBusinessProcessInstances.completedAt,
  }).from(hcmBusinessProcessInstances)
    .where(and(...predicates))
    .orderBy(desc(hcmBusinessProcessInstances.initiatedAt), desc(hcmBusinessProcessInstances.id))
    .limit(HCM_BP_MONITOR_PAGE_SIZE + 1);
  const page = rows.slice(0, HCM_BP_MONITOR_PAGE_SIZE);
  const hasMore = rows.length > HCM_BP_MONITOR_PAGE_SIZE;

  return {
    tenantId: organizationId,
    source: "hcm_business_process_instances",
    statusFilter,
    observedAt: new Date().toISOString(),
    items: page.map(projectBpMonitorInstance),
    hasMore,
    nextCursor: hasMore && page.length > 0 ? bpMonitorCursorFor(page[page.length - 1]) : null,
  };
}

/** Read only one tenant-authorized workflow. No definitionSnapshot, sourceKey,
 * decision notes or maker/checker mutations are ever projected. */
export async function loadBpMonitorDetail(
  organizationId: number,
  instanceId: number,
): Promise<BpMonitorDetailResponse | null> {
  const [instance] = await db.select({
    id: hcmBusinessProcessInstances.id,
    definitionCode: hcmBusinessProcessInstances.definitionCode,
    definitionVersion: hcmBusinessProcessInstances.definitionVersion,
    processType: hcmBusinessProcessInstances.processType,
    sourceType: hcmBusinessProcessInstances.sourceType,
    status: hcmBusinessProcessInstances.status,
    currentStepIndex: hcmBusinessProcessInstances.currentStepIndex,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedAt: hcmBusinessProcessInstances.initiatedAt,
    completedAt: hcmBusinessProcessInstances.completedAt,
  }).from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, organizationId),
    eq(hcmBusinessProcessInstances.id, instanceId),
  )).limit(1);
  if (!instance) return null;

  const rows = await db.select({
    id: hcmBusinessProcessInstanceSteps.id,
    stepIndex: hcmBusinessProcessInstanceSteps.stepIndex,
    stepType: hcmBusinessProcessInstanceSteps.stepType,
    assignee: hcmBusinessProcessInstanceSteps.assignee,
    status: hcmBusinessProcessInstanceSteps.status,
    dueAt: hcmBusinessProcessInstanceSteps.dueAt,
    completedAt: hcmBusinessProcessInstanceSteps.completedAt,
  }).from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
    eq(hcmBusinessProcessInstanceSteps.instanceId, instanceId),
  )).orderBy(asc(hcmBusinessProcessInstanceSteps.stepIndex), asc(hcmBusinessProcessInstanceSteps.id))
    .limit(HCM_BP_MONITOR_STEP_LIMIT + 1);

  const steps = rows.slice(0, HCM_BP_MONITOR_STEP_LIMIT);
  return {
    tenantId: organizationId,
    source: "hcm_business_process_instance_steps",
    observedAt: new Date().toISOString(),
    instance: projectBpMonitorInstance(instance),
    steps: steps.map((row) => projectBpMonitorStep(row)),
    hasMoreSteps: rows.length > HCM_BP_MONITOR_STEP_LIMIT,
    stepsPartial: rows.length > HCM_BP_MONITOR_STEP_LIMIT,
  };
}
