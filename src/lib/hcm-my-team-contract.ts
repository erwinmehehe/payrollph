/**
 * Linaw HCM My Team: read-only, source-linked contract.
 * This surface is not an approver inbox, payroll roster or headcount plan.
 */
export type MyTeamScope =
  | { kind: "company"; orgUnitId: null }
  | { kind: "unit"; orgUnitId: number };

export type MyTeamMember = {
  id: number;
  employeeNo: string;
  name: string;
  jobTitle: string;
  employmentType: string;
  status: string;
  orgUnitName: string | null;
  orgUnitIntegrity: "verified" | "not_recorded" | "unverified";
  pendingLeaveRecords: number;
  pendingOvertimeRecords: number;
};

export type MyTeamResponse = {
  organizationId: number;
  observedAt: string;
  scope: MyTeamScope;
  query: string;
  statusFilter: "all" | "Active" | "On leave" | "Separating";
  items: MyTeamMember[];
  page: { size: number; hasMore: boolean; nextCursor: number | null };
  summary: {
    employeeRecordsThisPage: number;
    pendingLeaveRecordsThisPage: number;
    pendingOvertimeRecordsThisPage: number;
  };
  warning: string;
};

export const MY_TEAM_STATUSES = ["all", "Active", "On leave", "Separating"] as const;
export type MyTeamStatusFilter = (typeof MY_TEAM_STATUSES)[number];

/**
 * HR admins can use company-wide or explicit-unit scope; managers must
 * have a concrete assigned unit. Never interpret manager-with-null-unit
 * as company-wide supervisory authority.
 */
export function deriveMyTeamScope(
  access: { role: string; companyWide: boolean; orgUnitId: number | null } | null,
): MyTeamScope | null {
  if (!access) return null;
  const fullRole = ["owner", "admin", "hr"].includes(access.role);
  if (fullRole && access.companyWide) return { kind: "company", orgUnitId: null };
  if (
    (fullRole || access.role === "manager") &&
    !access.companyWide &&
    typeof access.orgUnitId === "number" &&
    Number.isSafeInteger(access.orgUnitId) &&
    access.orgUnitId > 0
  ) return { kind: "unit", orgUnitId: access.orgUnitId };
  return null;
}

export function summarizeMyTeamPage(
  records: readonly Pick<MyTeamMember, "pendingLeaveRecords" | "pendingOvertimeRecords">[],
) {
  return {
    employeeRecordsThisPage: records.length,
    pendingLeaveRecordsThisPage: records.reduce((total, record) => total + record.pendingLeaveRecords, 0),
    pendingOvertimeRecordsThisPage: records.reduce((total, record) => total + record.pendingOvertimeRecords, 0),
  };
}
