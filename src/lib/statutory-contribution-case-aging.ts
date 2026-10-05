export type ContributionCaseServiceState =
  | "resolved"
  | "on_track"
  | "review_due_today"
  | "review_overdue"
  | "resolution_due_today"
  | "resolution_overdue";

export type ContributionCaseLike = {
  status: string;
  createdAt: Date | string;
  reviewStartedAt: Date | string | null;
  updatedAt: Date | string;
  resolvedAt?: Date | string | null;
};

const DAY_MS = 86_400_000;

function startOfUtcDay(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid contribution-case timestamp.");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addBusinessDays(value: Date | string, businessDays: number) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error("businessDays must be a non-negative integer.");
  }
  const date = startOfUtcDay(value);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) remaining -= 1;
  }
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: Date | string, to: Date | string) {
  return Math.floor((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS);
}

export function contributionCaseServiceTargets(caseRow: ContributionCaseLike) {
  const createdAt = startOfUtcDay(caseRow.createdAt);
  return {
    firstReviewDue: addBusinessDays(createdAt, 1),
    resolutionDue: addBusinessDays(createdAt, 5),
  };
}

export function contributionCaseServiceStatus(
  caseRow: ContributionCaseLike,
  now: Date | string = new Date(),
) {
  const nowDay = startOfUtcDay(now);
  const targets = contributionCaseServiceTargets(caseRow);
  const resolved = caseRow.status === "resolved" || Boolean(caseRow.resolvedAt);

  if (resolved) {
    return {
      state: "resolved" as const,
      overdue: false,
      targetDate: null,
      targetLabel: "Resolved",
      ageDays: Math.max(0, calendarDaysBetween(caseRow.createdAt, caseRow.resolvedAt ?? now)),
      firstReviewDue: isoDate(targets.firstReviewDue),
      resolutionDue: isoDate(targets.resolutionDue),
      internalPolicyNote: "PayrollPH service target, not a statutory or agency deadline.",
    };
  }

  const hasReviewStarted = Boolean(caseRow.reviewStartedAt) || caseRow.status === "in_review";
  if (!hasReviewStarted) {
    const delta = Math.floor((targets.firstReviewDue.getTime() - nowDay.getTime()) / DAY_MS);
    const state: ContributionCaseServiceState =
      delta < 0 ? "review_overdue" : delta === 0 ? "review_due_today" : "on_track";
    return {
      state,
      overdue: state === "review_overdue",
      targetDate: isoDate(targets.firstReviewDue),
      targetLabel: "First payroll review",
      ageDays: Math.max(0, calendarDaysBetween(caseRow.createdAt, now)),
      firstReviewDue: isoDate(targets.firstReviewDue),
      resolutionDue: isoDate(targets.resolutionDue),
      internalPolicyNote: "PayrollPH service target, not a statutory or agency deadline.",
    };
  }

  const delta = Math.floor((targets.resolutionDue.getTime() - nowDay.getTime()) / DAY_MS);
  const state: ContributionCaseServiceState =
    delta < 0 ? "resolution_overdue" : delta === 0 ? "resolution_due_today" : "on_track";
  return {
    state,
    overdue: state === "resolution_overdue",
    targetDate: isoDate(targets.resolutionDue),
    targetLabel: "Resolution or substantive employee update",
    ageDays: Math.max(0, calendarDaysBetween(caseRow.createdAt, now)),
    firstReviewDue: isoDate(targets.firstReviewDue),
    resolutionDue: isoDate(targets.resolutionDue),
    internalPolicyNote: "PayrollPH service target, not a statutory or agency deadline.",
  };
}
