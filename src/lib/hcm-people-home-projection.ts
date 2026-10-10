/**
 * HCM People Home: privacy-minimized, read-only projections of existing sources.
 *
 * The source workflows remain authoritative. A projection is never a task,
 * approval, HR record, or authorization decision in its own right.
 */
export type HcmHomeSource = "hcm_business_process" | "people_operations" | "operational_case";
export type HcmHomeStatus =
  | "pending_work"
  | "blocked_self_review"
  | "review_needed"
  | "follow_up"
  | "source_check"
  | "open_case"
  | "acknowledged_case";

export type HcmHomeItem = {
  source: HcmHomeSource;
  sourceId: string;
  tenantId: number;
  subjectEmployeeId: number | null;
  workflowType: string;
  label: string;
  status: HcmHomeStatus;
  /** Actual timestamp from an owning workflow; null never means overdue. */
  dueAt: string | null;
  /** Optional date-only milestone; never interpret it as a contractual SLA. */
  sourceDate: string | null;
  actionRoute: "People" | "Planning" | "Performance" | "Separation" | "WorkQueue";
  incompleteEvidence: boolean;
};

export type HcmHomeDecisionInput = {
  id: number;
  stepType: "approval" | "review" | "to_do";
  makerBlocked?: boolean;
  dueAt: string | null;
  processType: string;
  employee?: { id: number } | null;
};

export type HcmHomeFollowUpInput = {
  id: string;
  employeeId: number;
  category: "employment" | "onboarding" | "position" | "performance" | "separation";
  priority: "review" | "follow_up" | "source_check";
  dueDate: string | null;
  page: "People" | "Planning" | "Performance" | "Separation";
};

export type HcmHomeCaseInput = {
  id: number;
  status: string;
  dueAt: string | null;
};

const FOLLOW_UP_LABEL: Record<HcmHomeFollowUpInput["category"], string> = {
  employment: "Employment change",
  onboarding: "Onboarding follow-up",
  position: "Position / assignment",
  performance: "Performance follow-up",
  separation: "Separation follow-up",
};

function positiveId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function dateOnly(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Decisions are already assignee-authorized by the HCM BP source endpoint. */
export function projectHcmDecisions(tenantId: number, rows: readonly HcmHomeDecisionInput[]): HcmHomeItem[] {
  if (!positiveId(tenantId)) return [];
  return rows.filter((row) => positiveId(row.id)).map((row) => ({
    source: "hcm_business_process",
    sourceId: String(row.id),
    tenantId,
    subjectEmployeeId: row.employee && positiveId(row.employee.id) ? row.employee.id : null,
    workflowType: "HCM business process",
    label: row.stepType === "approval" ? "Approval step" : row.stepType === "review" ? "Review step" : "To-do step",
    status: row.makerBlocked ? "blocked_self_review" : "pending_work",
    dueAt: timestamp(row.dueAt),
    sourceDate: null,
    actionRoute: "People",
    incompleteEvidence: false,
  }));
}

/** Source checks are suggestions, NOT assigned tasks or confirmed violations. */
export function projectPeopleFollowUps(tenantId: number, rows: readonly HcmHomeFollowUpInput[]): HcmHomeItem[] {
  if (!positiveId(tenantId)) return [];
  return rows.filter((row) => positiveId(row.employeeId) && typeof row.id === "string" && row.id.length <= 100)
    .map((row) => ({
      source: "people_operations",
      sourceId: row.id,
      tenantId,
      subjectEmployeeId: row.employeeId,
      workflowType: row.category,
      label: FOLLOW_UP_LABEL[row.category],
      status: row.priority === "review" ? "review_needed" : row.priority,
      dueAt: null,
      sourceDate: dateOnly(row.dueDate),
      actionRoute: row.page,
      incompleteEvidence: row.priority === "source_check",
    }));
}

/** Case titles, free-text detail, owner PII and SLA history never enter the envelope. */
export function projectOperationalCases(tenantId: number, rows: readonly HcmHomeCaseInput[]): HcmHomeItem[] {
  if (!positiveId(tenantId)) return [];
  return rows.filter((row) => positiveId(row.id) && ["open", "acknowledged"].includes(row.status))
    .map((row) => ({
      source: "operational_case",
      sourceId: String(row.id),
      tenantId,
      subjectEmployeeId: null,
      workflowType: "operational_case",
      label: "Operational case #" + row.id,
      status: row.status === "acknowledged" ? "acknowledged_case" : "open_case",
      dueAt: timestamp(row.dueAt),
      sourceDate: null,
      actionRoute: "WorkQueue",
      incompleteEvidence: false,
    }));
}
