/**
 * Read-only decision queue. Approval policy and source record remain authoritative:
 * no client action or this response grants decision authority.
 */
export const DECISION_SOURCES = ["hcm", "leave", "overtime"] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];
export type ManagerDecisionScope =
  | { kind: "company"; orgUnitId: null }
  | { kind: "unit"; orgUnitId: number };
export type AssignmentKind = "role" | "named" | "delegated";
export type DueState = "overdue" | "upcoming" | "unscheduled";

export type ManagerDecisionItem = {
  id: number;
  source: DecisionSource;
  sourceRecordId: number;
  approvalTaskId: number | null;
  processType: string;
  stepType: "approval" | "review" | "to_do";
  status: "pending";
  priority: string;
  assignment: AssignmentKind;
  dueAt: string | null;
  dueState: DueState;
  employee: null | {
    id: number;
    employeeNo: string;
    name: string;
  };
};

export type ManagerDecisionPage = {
  organizationId: number;
  source: DecisionSource;
  scope: ManagerDecisionScope;
  observedAt: string;
  items: ManagerDecisionItem[];
  page: { size: number; hasMore: boolean; nextCursor: number | null };
  totals: { assignedItemsThisPage: number; overdueItemsThisPage: number };
  notice: string;
};

export function deriveManagerDecisionScope(
  access: { role: string; companyWide: boolean; orgUnitId: number | null } | null,
): ManagerDecisionScope | null {
  if (!access) return null;
  const hr = ["owner", "admin", "hr"].includes(access.role);
  if (hr && access.companyWide) return { kind: "company", orgUnitId: null };
  if ((hr || access.role === "manager") && !access.companyWide &&
      Number.isSafeInteger(access.orgUnitId) && (access.orgUnitId ?? 0) > 0) {
    return { kind: "unit", orgUnitId: access.orgUnitId! };
  }
  return null;
}

/** Only an actual step.dueAt is an SLA instant; never use leave dates as deadlines. */
export function projectDueState(dueAt: Date | string | null, now = new Date()): {
  dueAt: string | null; dueState: DueState;
} {
  if (!dueAt) return { dueAt: null, dueState: "unscheduled" };
  const parsed = new Date(dueAt);
  if (!Number.isFinite(parsed.getTime())) return { dueAt: null, dueState: "unscheduled" };
  return {
    dueAt: parsed.toISOString(),
    dueState: parsed.getTime() < now.getTime() ? "overdue" : "upcoming",
  };
}

/** Use pre-authorized source IDs; never derive counts from hidden tenant records. */
export function summarizeDecisionPage(items: readonly ManagerDecisionItem[]) {
  return {
    assignedItemsThisPage: items.length,
    overdueItemsThisPage: items.filter((item) => item.dueState === "overdue").length,
  };
}
