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


export type OvertimeRequestEvidence = {
  id: number;
  status: OvertimeRequestStatus;
  requestKind: OvertimeRequestKind;
  requestedMinutes: number;
  requestedByUserId?: number | null;
  decidedByUserId?: number | null;
};

export type OvertimeAuthorizationReviewReason =
  | "none"
  | "missing_request"
  | "multiple_requests"
  | "not_approved"
  | "exceeds_approved_minutes";

export type OvertimeAuthorizationDay = {
  actualOvertimeMinutes: number;
  authorizedMinutes: number;
  payrollEntitlementIndependent: true;
  reviewRequired: boolean;
  reviewReason: OvertimeAuthorizationReviewReason;
  requests: OvertimeRequestEvidence[];
};

/**
 * Produces payroll audit evidence for one work date. Multiple requests are
 * treated as ambiguous and fail closed for authorization purposes, while the
 * wage calculation remains independent and continues to use actual attendance.
 */
export function resolveOvertimeAuthorizationDay(input: {
  actualOvertimeMinutes: number;
  requests?: OvertimeRequestEvidence[];
}): OvertimeAuthorizationDay {
  const actual = Math.max(0, Math.trunc(input.actualOvertimeMinutes));
  const requests = [...(input.requests ?? [])].sort((a, b) => a.id - b.id);

  if (requests.length > 1) {
    return {
      actualOvertimeMinutes: actual,
      authorizedMinutes: 0,
      payrollEntitlementIndependent: true,
      reviewRequired: actual > 0,
      reviewReason: actual > 0 ? "multiple_requests" : "none",
      requests,
    };
  }

  const request = requests[0] ?? null;
  const authorization = resolveOvertimeAuthorization({
    actualOvertimeMinutes: actual,
    request,
  });

  let reviewReason: OvertimeAuthorizationReviewReason = "none";
  if (actual > 0 && !request) reviewReason = "missing_request";
  else if (actual > 0 && request?.status !== "approved") reviewReason = "not_approved";
  else if (actual > Math.max(0, Math.trunc(request?.requestedMinutes ?? 0))) {
    reviewReason = "exceeds_approved_minutes";
  }

  return {
    actualOvertimeMinutes: actual,
    authorizedMinutes: authorization.authorizedMinutes,
    payrollEntitlementIndependent: true,
    reviewRequired: authorization.reviewRequired,
    reviewReason,
    requests,
  };
}


export type OvertimeBudgetEvaluation = {
  budgetMinutes: number;
  approvedMinutesBefore: number;
  pendingMinutes: number;
  requestMinutes: number;
  remainingMinutesBefore: number;
  projectedApprovedMinutes: number;
  projectedUtilizationPercent: number;
  warningThresholdPercent: number;
  warning: boolean;
  overBudget: boolean;
};

/**
 * OT budget is an authorization/planning control only. It never changes
 * statutory wage entitlement. Managers may use this evidence to govern
 * approvals, while payroll remains based on validated worked overtime.
 */
export function evaluateOvertimeBudget(input: {
  budgetMinutes: number;
  approvedMinutesBefore: number;
  pendingMinutes?: number;
  requestMinutes?: number;
  warningThresholdPercent?: number;
}): OvertimeBudgetEvaluation {
  const budgetMinutes = Math.max(0, Math.trunc(input.budgetMinutes));
  const approvedMinutesBefore = Math.max(0, Math.trunc(input.approvedMinutesBefore));
  const pendingMinutes = Math.max(0, Math.trunc(input.pendingMinutes ?? 0));
  const requestMinutes = Math.max(0, Math.trunc(input.requestMinutes ?? 0));
  const warningThresholdPercent = Math.min(
    100,
    Math.max(1, Math.trunc(input.warningThresholdPercent ?? 80)),
  );
  const projectedApprovedMinutes = approvedMinutesBefore + requestMinutes;
  const projectedUtilizationPercent = budgetMinutes > 0
    ? Math.round((projectedApprovedMinutes / budgetMinutes) * 10_000) / 100
    : projectedApprovedMinutes > 0 ? 100 : 0;

  return {
    budgetMinutes,
    approvedMinutesBefore,
    pendingMinutes,
    requestMinutes,
    remainingMinutesBefore: Math.max(0, budgetMinutes - approvedMinutesBefore),
    projectedApprovedMinutes,
    projectedUtilizationPercent,
    warningThresholdPercent,
    warning: budgetMinutes > 0
      && projectedApprovedMinutes * 100 >= budgetMinutes * warningThresholdPercent,
    overBudget: projectedApprovedMinutes > budgetMinutes,
  };
}
