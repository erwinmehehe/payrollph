import { and, asc, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
} from "@/db/schema";
import {
  MONITOR_PAGE_SIZE, MONITOR_STEP_LIMIT,
  projectMonitorProcess, projectMonitorStep,
  validMonitorFilter,
  type HcmMonitorFilter, type HcmProcessMonitorPayload, type MonitorDetail,
} from "@/lib/hcm-process-monitor";

/**
 * Read-only bounded monitor projection; API/page are responsible for tenant
 * membership + HR/admin permission + session policy before invoking it.
 * Every table query is employer-qualified. No worker, pay, bank or free-text
 * workflow columns are selected, even for authorized company-wide HR users.
 */
export async function loadHcmProcessMonitor(input: {
  organizationId: number;
  filter: HcmMonitorFilter;
  cursor: number;
  selectedProcessId: number | null;
}, observedAt = new Date()): Promise<HcmProcessMonitorPayload> {
  const { organizationId, filter, cursor, selectedProcessId } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      !Number.isSafeInteger(cursor) || cursor < 0 ||
      (selectedProcessId !== null &&
        (!Number.isSafeInteger(selectedProcessId) || selectedProcessId < 1)) ||
      !validMonitorFilter(filter)) {
    throw new Error("Invalid HCM process monitor context.");
  }

  const conditions = [
    eq(hcmBusinessProcessInstances.organizationId, organizationId),
  ];
  if (cursor > 0) conditions.push(lt(hcmBusinessProcessInstances.id, cursor));
  if (filter !== "all") {
    conditions.push(eq(hcmBusinessProcessInstances.status, filter));
  }

  const candidates = await db.select({
    id: hcmBusinessProcessInstances.id,
    processType: hcmBusinessProcessInstances.processType,
    status: hcmBusinessProcessInstances.status,
    currentStepIndex: hcmBusinessProcessInstances.currentStepIndex,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedAt: hcmBusinessProcessInstances.initiatedAt,
    updatedAt: hcmBusinessProcessInstances.updatedAt,
    completedAt: hcmBusinessProcessInstances.completedAt,
  }).from(hcmBusinessProcessInstances)
    .where(and(...conditions))
    .orderBy(desc(hcmBusinessProcessInstances.id))
    .limit(MONITOR_PAGE_SIZE + 1);

  const hasMore = candidates.length > MONITOR_PAGE_SIZE;
  const items = candidates.slice(0, MONITOR_PAGE_SIZE)
    .map((row) => projectMonitorProcess(row, organizationId));

  let detail: MonitorDetail = {
    state: "not_selected", process: null, steps: [], stepsPartial: false,
  };
  if (selectedProcessId !== null) {
    const [record] = await db.select({
      id: hcmBusinessProcessInstances.id,
      processType: hcmBusinessProcessInstances.processType,
      status: hcmBusinessProcessInstances.status,
      currentStepIndex: hcmBusinessProcessInstances.currentStepIndex,
      effectiveDate: hcmBusinessProcessInstances.effectiveDate,
      initiatedAt: hcmBusinessProcessInstances.initiatedAt,
      updatedAt: hcmBusinessProcessInstances.updatedAt,
      completedAt: hcmBusinessProcessInstances.completedAt,
    }).from(hcmBusinessProcessInstances)
      .where(and(
        eq(hcmBusinessProcessInstances.organizationId, organizationId),
        eq(hcmBusinessProcessInstances.id, selectedProcessId),
      )).limit(1);
    if (!record) {
      detail = { state: "not_found", process: null, steps: [], stepsPartial: false };
    } else {
      // Qualify BOTH sides of the join: an incorrectly referenced step must
      // never be visible as a foreign-employer process detail.
      const stepRows = await db.select({
        id: hcmBusinessProcessInstanceSteps.id,
        stepIndex: hcmBusinessProcessInstanceSteps.stepIndex,
        stepType: hcmBusinessProcessInstanceSteps.stepType,
        status: hcmBusinessProcessInstanceSteps.status,
        assignee: hcmBusinessProcessInstanceSteps.assignee,
        dueAt: hcmBusinessProcessInstanceSteps.dueAt,
        completedAt: hcmBusinessProcessInstanceSteps.completedAt,
      }).from(hcmBusinessProcessInstanceSteps)
        .innerJoin(hcmBusinessProcessInstances, and(
          eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
          eq(hcmBusinessProcessInstances.organizationId, organizationId),
        ))
        .where(and(
          eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
          eq(hcmBusinessProcessInstanceSteps.instanceId, selectedProcessId),
        ))
        .orderBy(asc(hcmBusinessProcessInstanceSteps.stepIndex), asc(hcmBusinessProcessInstanceSteps.id))
        .limit(MONITOR_STEP_LIMIT + 1);
      detail = {
        state: "recorded",
        process: projectMonitorProcess(record, organizationId),
        steps: stepRows.slice(0, MONITOR_STEP_LIMIT).map((row) => projectMonitorStep(row, observedAt)),
        stepsPartial: stepRows.length > MONITOR_STEP_LIMIT,
      };
    }
  }

  return {
    tenantId: organizationId,
    observedAt: observedAt.toISOString(),
    filter,
    items,
    page: {
      size: MONITOR_PAGE_SIZE,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    },
    detail,
  };
}
