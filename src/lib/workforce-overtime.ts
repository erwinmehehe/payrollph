export type OvertimeRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type OvertimeRequestKind =
  | "pre_approved"
  | "emergency_post_approval";

export type OvertimeAuthorization = {
  requestId: number | null;
  status: OvertimeRequestStatus | "none";
  requestKind: OvertimeRequestKind | null;
  authorizedMinutes: number;
  requestedMinutes: number;
  payrollEntitlementIndependent: true;
  reviewRequired: boolean;
};

/**
 * OT authorization is an operational control, not the source of statutory
 * entitlement. Payroll must still calculate legally due overtime from actual,
 * validated attendance even when a manager failed to pre-authorize it.
 */
export function resolveOvertimeAuthorization(input: {
  actualOvertimeMinutes: number;
  request?: {
    id: number;
    status: OvertimeRequestStatus;
    requestKind: OvertimeRequestKind;
    requestedMinutes: number;
  } | null;
}): OvertimeAuthorization {
  const actual = Math.max(0, Math.trunc(input.actualOvertimeMinutes));
  const request = input.request ?? null;
  const requested = Math.max(0, Math.trunc(request?.requestedMinutes ?? 0));
  const approved = request?.status === "approved";

  return {
    requestId: request?.id ?? null,
    status: request?.status ?? "none",
    requestKind: request?.requestKind ?? null,
    requestedMinutes: requested,
    authorizedMinutes: approved ? Math.min(actual, requested) : 0,
    payrollEntitlementIndependent: true,
    reviewRequired:
      actual > 0 &&
      (!request || request.status !== "approved" || actual > requested),
  };
}
