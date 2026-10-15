/**
 * Privacy-minimized schedule-swap handoff checks for the WFM manager UI.
 *
 * These functions operate only on the already-authorized employer snapshot.
 * They do NOT read schedules, grant approval rights, reserve a roster slot or
 * replace the source API's MFA, role, conflict, shift and four-eyes checks.
 */
export type ScheduleSwapReviewItem = Readonly<{
  id: number;
  organizationId: number;
  requesterEmployeeId: number;
  counterpartyEmployeeId: number;
  requesterWorkDate: string;
  counterpartyWorkDate: string;
  requestedByUserId: number | null;
  status: string;
}>;

export type SwapDecisionReadiness = {
  canDecide: boolean;
  code: "ready_for_server_check" | "out_of_scope" | "finalized" |
    "missing_requester" | "same_requester" | "reviewer_unknown";
  detail: string;
};

function positiveId(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Frontend guidance only: server revalidates every decision under the roster lock. */
export function swapDecisionReadiness(
  row: ScheduleSwapReviewItem,
  organizationId: number,
  reviewerUserId: number | null | undefined,
): SwapDecisionReadiness {
  if (!positiveId(organizationId) || row.organizationId !== organizationId) {
    return { canDecide: false, code: "out_of_scope", detail: "The swap is outside the selected employer." };
  }
  if (row.status !== "pending") {
    return { canDecide: false, code: "finalized", detail: "This swap is no longer pending." };
  }
  // Source API denies both approval and rejection if requester identity is
  // missing; the UI must not offer a knowingly rejected action.
  if (!positiveId(row.requestedByUserId)) {
    return {
      canDecide: false, code: "missing_requester",
      detail: "Requester identity was not recorded. An authorized administrator must resolve or recreate this request.",
    };
  }
  if (!positiveId(reviewerUserId)) {
    return { canDecide: false, code: "reviewer_unknown", detail: "Reviewer identity is unavailable. Sign in again before deciding." };
  }
  if (row.requestedByUserId === reviewerUserId) {
    return {
      canDecide: false, code: "same_requester",
      detail: "You requested this swap. A different authorized workforce manager must review it.",
    };
  }
  return {
    canDecide: true, code: "ready_for_server_check",
    detail: "Server checks the reviewer's current access, MFA and both effective schedules before a decision.",
  };
}

export type SwapDraftPreflight = {
  state: "incomplete" | "blocked" | "unverified" | "ready";
  canSubmit: boolean;
  detail: string;
  conflictRequestId: number | null;
};

/**
 * Warn about a known pending employee/date claim without claiming that a
 * paged or stale client snapshot is the source of truth.
 *
 * A failed GET means the pending list is unknown, NOT empty. Submission may
 * still proceed so the authoritative POST can apply its real conflict gate.
 */
export function scheduleSwapDraftPreflight(input: {
  organizationId: number;
  requesterEmployeeId: number;
  counterpartyEmployeeId: number;
  requesterWorkDate: string;
  counterpartyWorkDate: string;
  reason: string;
  authorizedEmployeeIds: readonly number[];
  pendingSnapshot: readonly ScheduleSwapReviewItem[] | null;
}): SwapDraftPreflight {
  const result = (
    state: SwapDraftPreflight["state"],
    detail: string,
    conflictRequestId: number | null = null,
  ): SwapDraftPreflight => ({
    state, detail, conflictRequestId, canSubmit: state === "ready" || state === "unverified",
  });

  if (!positiveId(input.organizationId) || !positiveId(input.requesterEmployeeId) ||
      !positiveId(input.counterpartyEmployeeId)) {
    return result("incomplete", "Choose two employees from the selected employer.");
  }
  if (input.requesterEmployeeId === input.counterpartyEmployeeId) {
    return result("blocked", "A schedule cannot be swapped with the same employee.");
  }
  const allowed = new Set(input.authorizedEmployeeIds.filter(positiveId));
  if (!allowed.has(input.requesterEmployeeId) || !allowed.has(input.counterpartyEmployeeId)) {
    return result("blocked", "One or both employees are not in your currently authorized roster.");
  }
  if (!isCalendarDate(input.requesterWorkDate) || !isCalendarDate(input.counterpartyWorkDate)) {
    return result("incomplete", "Choose valid calendar dates for both employees.");
  }
  if (!input.reason.trim() || input.reason.trim().length > 240) {
    return result("incomplete", "Enter a reason of 1–240 characters for the swap.");
  }
  if (input.pendingSnapshot === null) {
    return result("unverified", "Pending requests could not be checked locally. The server will revalidate conflicts and schedules before saving.");
  }
  const uses = (row: ScheduleSwapReviewItem, employeeId: number, date: string) =>
    (row.requesterEmployeeId === employeeId && row.requesterWorkDate === date) ||
    (row.counterpartyEmployeeId === employeeId && row.counterpartyWorkDate === date);
  const conflict = input.pendingSnapshot.find((row) =>
    row.organizationId === input.organizationId &&
    row.status === "pending" && positiveId(row.id) && (
      uses(row, input.requesterEmployeeId, input.requesterWorkDate) ||
      uses(row, input.counterpartyEmployeeId, input.counterpartyWorkDate)
    ),
  );
  if (conflict) {
    return result(
      "blocked",
      "Pending swap #" + conflict.id + " already uses one of these employee/date assignments. Review that request first.",
      conflict.id,
    );
  }
  return result("ready", "No conflicting request is shown in this snapshot. The server independently validates live schedules and pending assignments.");
}
