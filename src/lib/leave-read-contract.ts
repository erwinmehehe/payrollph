import type { DashboardData, LeavePolicy, LeaveRequest } from "@/components/workspace/types";

export type VerifiedLeaveData = DashboardData & {
  leaveRequests: LeaveRequest[];
  leavePolicies: LeavePolicy[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function nonnegativeNumber(value: unknown): boolean {
  return text(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
}
function positiveId(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function leaveRow(value: unknown): boolean {
  if (!record(value)) return false;
  return positiveId(value.id) && positiveId(value.employeeId) &&
    text(value.leaveType) && text(value.startDate) && text(value.endDate) &&
    nonnegativeNumber(value.days) && text(value.status) &&
    (value.intervals == null || (Array.isArray(value.intervals) &&
      value.intervals.every((item: unknown) =>
        record(item) && text(item.workDate) && text(item.kind))));
}
function policyRow(value: unknown): boolean {
  if (!record(value)) return false;
  return positiveId(value.id) && text(value.leaveType) &&
    nonnegativeNumber(value.annualDays) &&
    text(value.payTreatment) && nonnegativeNumber(value.paidPercentage) &&
    typeof value.active === "boolean";
}

/** A verified empty list is valid; a missing or malformed source is not.
 * Leave is a narrower read contract than the general workspace dashboard.
 */
export function hasVerifiedLeaveCollections(data: DashboardData): data is VerifiedLeaveData {
  return Array.isArray(data.leaveRequests) && data.leaveRequests.every(leaveRow) &&
    Array.isArray(data.leavePolicies) && data.leavePolicies.every(policyRow);
}
