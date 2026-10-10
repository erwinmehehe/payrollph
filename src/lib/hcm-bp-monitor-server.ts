import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps } from "@/db/schema";
import { projectMonitor } from "@/lib/hcm-bp-monitor-projection";
import type { HcmMonitorPage } from "@/lib/hcm-bp-monitor-contract";

export const HCM_BP_MONITOR_PAGE_SIZE = 30;
export const HCM_BP_MONITOR_STEP_CEILING = 750;

export class HcmMonitorSourceCapError extends Error {
  constructor() { super("Workflow step source exceeds the bounded monitor preview"); }
}

/**
 * Caller MUST authorize the explicitly requested tenant first. Neither the
 * process status nor a dashboard step can approve or mutate source workflows.
 */
export async function loadMonitor(
  organizationId: number,
  beforeId: number | null,
): Promise<HcmMonitorPage> {
  const conditions = [eq(hcmBusinessProcessInstances.organizationId, organizationId)];
  if (beforeId !== null) conditions.push(lt(hcmBusinessProcessInstances.id, beforeId));

  // Stable keyset pagination; SQL filters before the ceiling.
  const candidates = await db.select({
    id: hcmBusinessProcessInstances.id,
    processType: hcmBusinessProcessInstances.processType,
    status: hcmBusinessProcessInstances.status,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedAt: hcmBusinessProcessInstances.initiatedAt,
    currentStepIndex: hcmBusinessProcessInstances.currentStepIndex,
  }).from(hcmBusinessProcessInstances)
    .where(and(...conditions))
    .orderBy(desc(hcmBusinessProcessInstances.id))
    .limit(HCM_BP_MONITOR_PAGE_SIZE + 1);

  const visible = candidates.slice(0, HCM_BP_MONITOR_PAGE_SIZE);
  const ids = visible.map((instance) => instance.id);
  const stepRows = ids.length === 0 ? [] : await db.select({
    id: hcmBusinessProcessInstanceSteps.id,
    instanceId: hcmBusinessProcessInstanceSteps.instanceId,
    stepIndex: hcmBusinessProcessInstanceSteps.stepIndex,
    stepType: hcmBusinessProcessInstanceSteps.stepType,
    status: hcmBusinessProcessInstanceSteps.status,
    dueAt: hcmBusinessProcessInstanceSteps.dueAt,
  }).from(hcmBusinessProcessInstanceSteps)
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
      inArray(hcmBusinessProcessInstanceSteps.instanceId, ids),
    ))
    .orderBy(
      asc(hcmBusinessProcessInstanceSteps.instanceId),
      asc(hcmBusinessProcessInstanceSteps.stepIndex),
    )
    .limit(HCM_BP_MONITOR_STEP_CEILING + 1);

  // Never claim that a partial set of steps is a complete approval timeline.
  if (stepRows.length > HCM_BP_MONITOR_STEP_CEILING) {
    throw new HcmMonitorSourceCapError();
  }
  const hasMore = candidates.length > HCM_BP_MONITOR_PAGE_SIZE;
  return {
    tenantId: organizationId,
    observedAt: new Date().toISOString(),
    pageSize: HCM_BP_MONITOR_PAGE_SIZE,
    items: projectMonitor(visible, stepRows),
    hasMore,
    nextCursor: hasMore ? visible[visible.length - 1]?.id ?? null : null,
  };
}
