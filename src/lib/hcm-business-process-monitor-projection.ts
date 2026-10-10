/**
 * Business Process Monitor read-model only. Never use these helpers to decide,
 * approve, delegate, correct, cancel, or apply an HR or payroll transaction.
 */
export const HCM_BP_MONITOR_STATUSES = [
  "all", "in_progress", "approved", "declined", "cancelled", "applied", "failed",
] as const;
export type HcmBpMonitorFilter = (typeof HCM_BP_MONITOR_STATUSES)[number];
export type HcmBpMonitorStatus = Exclude<HcmBpMonitorFilter, "all"> | "unknown";
export type HcmBpMonitorSla = "overdue" | "due_later" | "untracked" | "not_pending";

export const HCM_BP_MONITOR_PAGE_SIZE = 20;
export const HCM_BP_MONITOR_STEP_LIMIT = 100;
const knownStatuses = new Set<string>(HCM_BP_MONITOR_STATUSES);

export function validBpMonitorFilter(value: string): value is HcmBpMonitorFilter {
  return knownStatuses.has(value);
}

export function bpMonitorStatus(value: string): HcmBpMonitorStatus {
  return value !== "all" && knownStatuses.has(value)
    ? value as HcmBpMonitorStatus : "unknown";
}

export type BpMonitorInstanceSource = {
  id: number;
  definitionCode: string;
  definitionVersion: number;
  processType: string;
  sourceType: string;
  status: string;
  currentStepIndex: number;
  effectiveDate: string | null;
  initiatedAt: Date;
  completedAt: Date | null;
};

export type BpMonitorInstance = {
  id: number;
  definitionCode: string;
  definitionVersion: number;
  processType: string;
  sourceType: string;
  status: HcmBpMonitorStatus;
  currentStepIndex: number;
  effectiveDate: string | null;
  initiatedAt: string;
  completedAt: string | null;
};

export type BpMonitorStepSource = {
  id: number;
  stepIndex: number;
  stepType: string;
  assignee: string;
  status: string;
  dueAt: Date | null;
  completedAt: Date | null;
};

export type BpMonitorStep = {
  id: number;
  stepIndex: number;
  stepType: "approval" | "review" | "to_do" | "unknown";
  assignee: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  sla: HcmBpMonitorSla;
};

export function projectBpMonitorInstance(row: BpMonitorInstanceSource): BpMonitorInstance {
  // Whitelist fields. No free-text notes, sourceKey, snapshot JSON, employee
  // names, pay details, reviewer comments, signatures or audit metadata.
  return {
    id: row.id, definitionCode: row.definitionCode,
    definitionVersion: row.definitionVersion,
    processType: row.processType, sourceType: row.sourceType,
    status: bpMonitorStatus(row.status), currentStepIndex: row.currentStepIndex,
    effectiveDate: row.effectiveDate,
    initiatedAt: row.initiatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function projectBpMonitorStep(
  row: BpMonitorStepSource, now = new Date(),
): BpMonitorStep {
  const isPending = row.status === "pending";
  const sla: HcmBpMonitorSla = !isPending ? "not_pending"
    : row.dueAt === null ? "untracked"
    : row.dueAt.getTime() < now.getTime() ? "overdue" : "due_later";
  return {
    id: row.id, stepIndex: row.stepIndex,
    stepType: ["approval", "review", "to_do"].includes(row.stepType)
      ? row.stepType as BpMonitorStep["stepType"] : "unknown",
    // Company-wide People administrators may inspect reviewer assignment;
    // never include step free-text decisionNote or definitionSnapshot.
    assignee: row.assignee,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    sla,
  };
}

export type BpMonitorCursor = { initiatedAt: Date; id: number };

export function parseBpMonitorCursor(raw: string | null): BpMonitorCursor | null {
  if (!raw || raw.length > 80) return null;
  const match = /^(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([1-9]\d*)$/.exec(raw);
  if (!match) return null;
  const date = new Date(match[1]);
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0 || Number.isNaN(date.getTime()) ||
      date.toISOString() !== match[1]) return null;
  return { initiatedAt: date, id };
}

export function bpMonitorCursorFor(row: BpMonitorInstanceSource): string {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) throw new Error("Invalid BP cursor");
  return row.initiatedAt.toISOString() + "~" + row.id;
}
