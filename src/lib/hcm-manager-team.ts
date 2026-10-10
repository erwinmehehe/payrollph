import { philippineWorker360Date } from "@/lib/hcm-worker-360-projection";

export const MANAGER_TEAM_PAGE_SIZE = 20;

/** Strict decimal resource/cursor parsing: never accept floats or exponential IDs. */
export function managerTeamPositiveId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function managerTeamBusinessDate(now = new Date()): string {
  return philippineWorker360Date(now);
}

export type ManagerTeamSourceRow = {
  assignmentId: number;
  employeeId: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  employeeStatus: string;
  positionCode: string;
  positionStatus: string;
  unitName: string | null;
  assignmentFrom: string;
  assignmentUntil: string | null;
};

export type ManagerTeamItem = {
  assignmentId: number;
  employeeId: number;
  employeeNo: string;
  name: string;
  currentStatus: string;
  currentPositionCode: string;
  currentOrgUnit: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  evidence: "recorded_current_assignment" | "position_status_needs_review";
};

export type ManagerTeamPage = {
  organizationId: number;
  managerEmployeeId: number;
  businessDate: string;
  scope: "verified_current_direct_reports";
  items: ManagerTeamItem[];
  hasMore: boolean;
  nextCursor: number | null;
  // Not a headcount census: a page of verified relationships, not all employees.
  completeness: "page_only_unverified_relationships_excluded";
};

/** Source rows are from tenant-bound SQL and already ordered newest ID first. */
export function projectManagerTeamPage(
  rows: readonly ManagerTeamSourceRow[],
  input: { organizationId: number; managerEmployeeId: number; businessDate: string },
): ManagerTeamPage {
  if (!managerTeamPositiveId(String(input.organizationId)) ||
    !managerTeamPositiveId(String(input.managerEmployeeId)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ||
    rows.some((row, index) => !managerTeamPositiveId(String(row.assignmentId)) ||
      (index > 0 && rows[index - 1].assignmentId <= row.assignmentId))) {
    throw new Error("Manager team source evidence is invalid.");
  }
  const pageRows = rows.slice(0, MANAGER_TEAM_PAGE_SIZE);
  const items: ManagerTeamItem[] = pageRows.map((row) => ({
    assignmentId: row.assignmentId,
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
    currentStatus: row.employeeStatus,
    currentPositionCode: row.positionCode,
    currentOrgUnit: row.unitName,
    effectiveFrom: row.assignmentFrom,
    effectiveUntil: row.assignmentUntil,
    evidence: row.positionStatus === "filled"
      ? "recorded_current_assignment"
      : "position_status_needs_review",
  }));
  const hasMore = rows.length > MANAGER_TEAM_PAGE_SIZE;
  return {
    organizationId: input.organizationId,
    managerEmployeeId: input.managerEmployeeId,
    businessDate: input.businessDate,
    scope: "verified_current_direct_reports",
    items,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].assignmentId : null,
    completeness: "page_only_unverified_relationships_excluded",
  };
}
