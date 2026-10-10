export const HCM_TERM_DECISION_CANCELLABLE_STATES = [
  "pending_approval", "scheduled", "failed",
] as const;

/** Reject invalid Gregorian dates, not just strings shaped like YYYY-MM-DD. */
export function validHcmCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type EmploymentDecisionCancellationState = {
  status: string;
  separationHandoffStatus: string;
  separationRecordId: number | null;
  successorTermId: number | null;
};

export function cancellationBlocker(decision: EmploymentDecisionCancellationState): string | null {
  if (!HCM_TERM_DECISION_CANCELLABLE_STATES.some(status => status === decision.status)) {
    return "TERM_DECISION_NOT_CANCELLABLE";
  }
  if (decision.separationHandoffStatus !== "none" || decision.separationRecordId != null) {
    return "TERM_DECISION_SEPARATION_HANDOFF_STARTED";
  }
  if (decision.successorTermId != null) {
    return "TERM_DECISION_SUCCESSOR_ALREADY_PREPARED";
  }
  return null;
}

export function retryBlocker(decision: EmploymentDecisionCancellationState & {
  approvedByUserId: number | null;
  evidenceSnapshotSha256: string | null;
  evidenceSealedAt: Date | null;
}): string | null {
  if (decision.status !== "failed" || decision.approvedByUserId == null) {
    return "TERM_DECISION_RETRY_REQUIRES_APPROVAL";
  }
  if (!decision.evidenceSnapshotSha256 || !decision.evidenceSealedAt) {
    return "TERM_DECISION_RETRY_UNSEALED";
  }
  if (decision.separationHandoffStatus !== "none" || decision.separationRecordId != null) {
    return "TERM_DECISION_SEPARATION_HANDOFF_STARTED";
  }
  if (decision.successorTermId != null) {
    return "TERM_DECISION_SUCCESSOR_ALREADY_PREPARED";
  }
  return null;
}
