export type EmploymentLifecycleAction =
  | "configure_terms"
  | "record_decision"
  | "review_decision"
  | "await_effective_date"
  | "retry_decision"
  | "start_separation"
  | "continue_separation"
  | "none";

export type EmploymentLifecycleState =
  | "unconfigured"
  | "clear"
  | "upcoming"
  | "action_required"
  | "in_progress"
  | "complete";

export type EmploymentLifecycleTerm = {
  id: number;
  termKind: string;
  employmentType: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  probationReviewDate?: string | null;
  contractEndDate?: string | null;
  status: string;
};

export type EmploymentLifecycleDecision = {
  id: number;
  decisionKind: string;
  status: string;
  effectiveDate: string;
  proposedSeparationLastDay?: string | null;
  separationHandoffStatus?: string | null;
  separationRecordId?: number | null;
  failure?: string | null;
};

export type EmploymentLifecycleSeparation = {
  id: number;
  status: string;
  lastDay: string;
} | null;

function dayDiff(from: string, to: string) {
  return Math.round(
    (new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime())
      / 86_400_000,
  );
}

function termDueDate(term: EmploymentLifecycleTerm) {
  if (term.termKind === "probationary") return term.probationReviewDate ?? null;
  if (["fixed_term", "project", "seasonal", "casual"].includes(term.termKind)) {
    return term.contractEndDate ?? term.effectiveUntil ?? null;
  }
  return term.effectiveUntil ?? null;
}

export function buildEmploymentLifecycleRow(input: {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  employeeStatus: string;
  term: EmploymentLifecycleTerm | null;
  decision: EmploymentLifecycleDecision | null;
  separation: EmploymentLifecycleSeparation;
  today: string;
}) {
  const { term, decision, separation, today } = input;

  if (!term) {
    return {
      ...input,
      state: "unconfigured" as const,
      severity: "warning" as const,
      action: "configure_terms" as const,
      dueDate: null,
      daysUntil: null,
      label: "Employment terms not yet governed",
      detail: "Create the worker's effective-dated employment terms before relying on lifecycle deadlines.",
    };
  }

  if (decision?.status === "failed") {
    return {
      ...input,
      state: "action_required" as const,
      severity: "blocker" as const,
      action: "retry_decision" as const,
      dueDate: decision.effectiveDate,
      daysUntil: dayDiff(today, decision.effectiveDate),
      label: "Employment decision failed",
      detail: decision.failure || "Retry or cancel the failed governed decision.",
    };
  }

  if (decision?.status === "pending_approval") {
    return {
      ...input,
      state: "action_required" as const,
      severity: "warning" as const,
      action: "review_decision" as const,
      dueDate: decision.effectiveDate,
      daysUntil: dayDiff(today, decision.effectiveDate),
      label: "Employment decision awaiting approval",
      detail: "A second People administrator must approve or cancel this decision.",
    };
  }

  if (decision?.status === "scheduled") {
    return {
      ...input,
      state: "in_progress" as const,
      severity: "info" as const,
      action: "await_effective_date" as const,
      dueDate: decision.effectiveDate,
      daysUntil: dayDiff(today, decision.effectiveDate),
      label: "Approved employment decision scheduled",
      detail: "The approved decision will apply on its effective date.",
    };
  }

  if (decision?.status === "applied" && decision.decisionKind === "non_renew") {
    const handoff = decision.separationHandoffStatus ?? "ready";
    if (handoff === "ready") {
      const dueDate = decision.proposedSeparationLastDay ?? decision.effectiveDate;
      return {
        ...input,
        state: "action_required" as const,
        severity: "blocker" as const,
        action: "start_separation" as const,
        dueDate,
        daysUntil: dayDiff(today, dueDate),
        label: "Non-renewal approved — Separation not started",
        detail: "Start the linked end-of-contract Separation and final-pay workflow.",
      };
    }
    if (handoff === "started") {
      return {
        ...input,
        state: "in_progress" as const,
        severity: "warning" as const,
        action: "continue_separation" as const,
        dueDate: decision.proposedSeparationLastDay ?? separation?.lastDay ?? null,
        daysUntil: decision.proposedSeparationLastDay
          ? dayDiff(today, decision.proposedSeparationLastDay)
          : separation?.lastDay
            ? dayDiff(today, separation.lastDay)
            : null,
        label: "Separation in progress",
        detail: "Complete clearance, final-pay approval, and release in the linked Separation workflow.",
      };
    }
    if (handoff === "completed") {
      return {
        ...input,
        state: "complete" as const,
        severity: "info" as const,
        action: "none" as const,
        dueDate: decision.proposedSeparationLastDay ?? separation?.lastDay ?? null,
        daysUntil: null,
        label: "Employment lifecycle completed",
        detail: "The non-renewal handoff is closed through released final pay.",
      };
    }
  }

  const dueDate = termDueDate(term);
  if (!dueDate) {
    return {
      ...input,
      state: "clear" as const,
      severity: "info" as const,
      action: "none" as const,
      dueDate: null,
      daysUntil: null,
      label: "No lifecycle action due",
      detail: "The active employment terms have no review or end date requiring action.",
    };
  }

  const daysUntil = dayDiff(today, dueDate);
  const isProbation = term.termKind === "probationary";
  const noun = isProbation ? "Probation review" : "Employment term end";

  if (daysUntil <= 0) {
    return {
      ...input,
      state: "action_required" as const,
      severity: "blocker" as const,
      action: "record_decision" as const,
      dueDate,
      daysUntil,
      label: daysUntil === 0 ? `${noun} due today` : `${noun} overdue`,
      detail: "Record an explicit governed decision. PayrollPH will not infer regularization, renewal, or separation.",
    };
  }

  if (daysUntil <= 30) {
    return {
      ...input,
      state: "upcoming" as const,
      severity: daysUntil <= 7 ? "warning" as const : "info" as const,
      action: "record_decision" as const,
      dueDate,
      daysUntil,
      label: `${noun} due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
      detail: "Prepare and route the employment decision before the due date.",
    };
  }

  return {
    ...input,
    state: "clear" as const,
    severity: "info" as const,
    action: "none" as const,
    dueDate,
    daysUntil,
    label: "Lifecycle date is scheduled",
    detail: `${noun} is outside the 30-day action window.`,
  };
}

export function summarizeEmploymentLifecycle(rows: Array<ReturnType<typeof buildEmploymentLifecycleRow>>) {
  return {
    total: rows.length,
    actionRequired: rows.filter((row) => row.state === "action_required").length,
    upcoming: rows.filter((row) => row.state === "upcoming").length,
    inProgress: rows.filter((row) => row.state === "in_progress").length,
    unconfigured: rows.filter((row) => row.state === "unconfigured").length,
    handoffReady: rows.filter((row) => row.action === "start_separation").length,
  };
}

export function sortEmploymentLifecycleRows<T extends ReturnType<typeof buildEmploymentLifecycleRow>>(rows: T[]) {
  const rank: Record<EmploymentLifecycleState, number> = {
    action_required: 0,
    upcoming: 1,
    in_progress: 2,
    unconfigured: 3,
    clear: 4,
    complete: 5,
  };
  return [...rows].sort((a, b) => {
    const state = rank[a.state] - rank[b.state];
    if (state) return state;
    const aDays = a.daysUntil == null ? Number.MAX_SAFE_INTEGER : a.daysUntil;
    const bDays = b.daysUntil == null ? Number.MAX_SAFE_INTEGER : b.daysUntil;
    if (aDays !== bDays) return aDays - bDays;
    return a.employeeName.localeCompare(b.employeeName);
  });
}
