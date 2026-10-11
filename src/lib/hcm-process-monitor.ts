/**
 * Minimal, read-only HCM process monitor contract.
 * Controlled labels intentionally discard free-text step labels, assignees,
 * process source keys and snapshots. No finance or employee data is selected.
 */
export const MONITOR_PAGE_SIZE = 20;
export const MONITOR_STEP_LIMIT = 12;

export const MONITOR_FILTERS = [
  "all", "in_progress", "approved", "declined", "cancelled", "applied", "failed",
] as const;
export type HcmMonitorFilter = (typeof MONITOR_FILTERS)[number];

const PROCESS_LABELS: Readonly<Record<string, string>> = {
  change_job: "Change job",
  transfer: "Transfer",
  promotion: "Promotion",
  compensation_change: "Compensation change",
  hire: "Hire",
  termination: "Termination",
  create_position: "Create position",
  close_position: "Close position",
};

const PROCESS_STATUSES: Readonly<Record<string, string>> = {
  in_progress: "Awaiting workflow steps",
  approved: "Approved · source application not verified",
  declined: "Declined",
  cancelled: "Cancelled",
  applied: "Applied in source · not payroll release",
  failed: "Source application failed",
};

const STEP_STATUSES: Readonly<Record<string, string>> = {
  waiting: "Not yet active",
  pending: "Awaiting assigned action",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

const STEP_TYPES: Readonly<Record<string, string>> = {
  approval: "Approval",
  review: "Review",
  to_do: "To do",
};

export function canonicalHcmId(value: string | null, allowZero = false): number | null {
  const pattern = allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (value === null || !pattern.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0)
    ? number : null;
}

export function monitorEnabledForEmployer(
  employerId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(employerId) || employerId < 1) return false;
  if (env.HCM_PROCESS_MONITOR_ENABLED !== "true") return false;
  return (env.HCM_PROCESS_MONITOR_ORG_IDS ?? "").split(",").some((entry) =>
    canonicalHcmId(entry.trim()) === employerId);
}

export function canReadHcmProcessMonitor(
  access: { role: string; companyWide: boolean } | null | undefined,
): boolean {
  return !!access?.companyWide && ["owner", "admin", "hr"].includes(access.role);
}

export function validMonitorFilter(value: string): value is HcmMonitorFilter {
  return MONITOR_FILTERS.some((filter) => filter === value);
}

function controlledLabel(value: string, labels: Readonly<Record<string, string>>) {
  return Object.prototype.hasOwnProperty.call(labels, value)
    ? labels[value] : "Unrecognized source state";
}

/** Keep date-only PH business dates separate from timed SLA instants. */
export function monitorBusinessDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value : null;
}

function sourceInstant(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

export type MonitorProcessItem = {
  id: number;
  tenantId: number;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  currentStepIndex: number | null;
  effectiveDate: string | null;
  initiatedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};
export type MonitorStepItem = {
  id: number;
  stepIndex: number;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  assignmentKind: "role" | "named_or_other" | "unrecorded";
  dueAt: string | null;
  dueEvidence: "recorded" | "missing" | "unverified";
  overdue: boolean;
  completedAt: string | null;
};
export type MonitorDetail =
  | { state: "not_selected" | "not_found"; process: null; steps: []; stepsPartial: false }
  | { state: "recorded"; process: MonitorProcessItem; steps: MonitorStepItem[]; stepsPartial: boolean };

export type HcmProcessMonitorPayload = {
  tenantId: number;
  observedAt: string;
  filter: HcmMonitorFilter;
  items: MonitorProcessItem[];
  page: { size: number; hasMore: boolean; nextCursor: number | null };
  detail: MonitorDetail;
};

export function projectMonitorProcess(row: {
  id: number; processType: string; status: string; currentStepIndex: number;
  effectiveDate: string | null; initiatedAt: Date | string | null;
  updatedAt: Date | string | null; completedAt: Date | string | null;
}, tenantId: number): MonitorProcessItem {
  return {
    id: row.id, tenantId,
    type: Object.hasOwn(PROCESS_LABELS, row.processType) ? row.processType : "other",
    typeLabel: Object.hasOwn(PROCESS_LABELS, row.processType)
      ? PROCESS_LABELS[row.processType] : "Other recorded process",
    status: Object.hasOwn(PROCESS_STATUSES, row.status) ? row.status : "unknown",
    statusLabel: controlledLabel(row.status, PROCESS_STATUSES),
    currentStepIndex: Number.isSafeInteger(row.currentStepIndex) && row.currentStepIndex >= 0
      ? row.currentStepIndex : null,
    effectiveDate: monitorBusinessDate(row.effectiveDate),
    initiatedAt: sourceInstant(row.initiatedAt),
    updatedAt: sourceInstant(row.updatedAt),
    completedAt: sourceInstant(row.completedAt),
  };
}

export function projectMonitorStep(row: {
  id: number; stepIndex: number; stepType: string; status: string;
  assignee: string | null; dueAt: Date | string | null; completedAt: Date | string | null;
}, observedAt: Date): MonitorStepItem {
  const dueAt = sourceInstant(row.dueAt);
  return {
    id: row.id,
    stepIndex: row.stepIndex,
    type: Object.hasOwn(STEP_TYPES, row.stepType) ? row.stepType : "unknown",
    typeLabel: controlledLabel(row.stepType, STEP_TYPES),
    status: Object.hasOwn(STEP_STATUSES, row.status) ? row.status : "unknown",
    statusLabel: controlledLabel(row.status, STEP_STATUSES),
    assignmentKind: !row.assignee ? "unrecorded"
      : /^role:[a-z_]{2,32}$/.test(row.assignee) ? "role" : "named_or_other",
    dueAt,
    dueEvidence: row.dueAt == null ? "missing" : dueAt ? "recorded" : "unverified",
    // Only active pending steps can be overdue; missing/invalid SLA != safe.
    overdue: row.status === "pending" && dueAt !== null &&
      new Date(dueAt).getTime() < observedAt.getTime(),
    completedAt: sourceInstant(row.completedAt),
  };
}
