/**
 * Read-only HCM process monitor: a privacy-minimized projection of governed
 * source records, never a second business-process decision engine.
 */
export type MonitorInstance = {
  id: number;
  processType: string;
  status: string;
  effectiveDate: string | null;
  initiatedAt: Date | string;
  currentStepIndex: number;
};
export type MonitorStep = {
  id: number;
  instanceId: number;
  stepIndex: number;
  stepType: string;
  status: string;
  dueAt: Date | string | null;
};
export type MonitorSla = "overdue" | "due" | "not_due" | "no_due_date" | "completed" | "not_applicable";
export type MonitorStepView = {
  id: number;
  stepIndex: number;
  type: string;
  status: string;
  dueAt: string | null;
  sla: MonitorSla;
};
export type MonitorItem = MonitorInstance & { steps: MonitorStepView[] };

function safeTimestamp(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * SLA is based ONLY on real step.dueAt, not an effective business date.
 * Only pending steps accrue an SLA; waiting/cancelled/declined steps are
 * explicitly not applicable rather than masquerading as on time.
 */
export function projectMonitor(
  instances: readonly MonitorInstance[],
  steps: readonly MonitorStep[],
  now = new Date(),
): MonitorItem[] {
  const eligible = new Set(instances.map((instance) => instance.id));
  const byInstance = new Map<number, MonitorStepView[]>();
  for (const step of steps) {
    if (!eligible.has(step.instanceId)) continue;
    const dueAt = safeTimestamp(step.dueAt);
    let sla: MonitorSla;
    if (step.status === "completed") sla = "completed";
    else if (step.status !== "pending") sla = "not_applicable";
    else if (!dueAt) sla = "no_due_date";
    else {
      const time = new Date(dueAt).getTime();
      sla = time < now.getTime() ? "overdue" : time === now.getTime() ? "due" : "not_due";
    }
    const list = byInstance.get(step.instanceId) ?? [];
    list.push({
      id: step.id,
      stepIndex: step.stepIndex,
      type: step.stepType,
      status: step.status,
      dueAt,
      sla,
    });
    byInstance.set(step.instanceId, list);
  }
  return instances.map((instance) => ({
    id: instance.id,
    processType: instance.processType,
    status: instance.status,
    effectiveDate: instance.effectiveDate,
    initiatedAt: instance.initiatedAt,
    currentStepIndex: instance.currentStepIndex,
    steps: (byInstance.get(instance.id) ?? [])
      .sort((a, b) => a.stepIndex - b.stepIndex || a.id - b.id),
  }));
}
