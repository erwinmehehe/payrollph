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

function manilaDateParts(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid contribution-case timestamp.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function startOfManilaDay(value: Date | string) {
  const parts = manilaDateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addBusinessDays(value: Date | string, businessDays: number) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error("businessDays must be a non-negative integer.");
  }
  const date = startOfManilaDay(value);
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
  return Math.floor((startOfManilaDay(to).getTime() - startOfManilaDay(from).getTime()) / DAY_MS);
}

export function contributionCaseServiceTargets(caseRow: ContributionCaseLike) {
  const createdAt = startOfManilaDay(caseRow.createdAt);
  return {
    firstReviewDue: addBusinessDays(createdAt, 1),
    resolutionDue: addBusinessDays(createdAt, 5),
  };
}

export function contributionCaseServiceStatus(
  caseRow: ContributionCaseLike,
  now: Date | string = new Date(),
) {
  const nowDay = startOfManilaDay(now);
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
    targetLabel: "Resolution",
    ageDays: Math.max(0, calendarDaysBetween(caseRow.createdAt, now)),
    firstReviewDue: isoDate(targets.firstReviewDue),
    resolutionDue: isoDate(targets.resolutionDue),
    internalPolicyNote: "PayrollPH service target, not a statutory or agency deadline.",
  };
}


export type ContributionCaseEscalationStage = 0 | 1 | 2 | 3;

export function businessDaysPastTarget(
  targetDate: string,
  now: Date | string = new Date(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("targetDate must use YYYY-MM-DD.");
  }
  const target = new Date(`${targetDate}T00:00:00Z`);
  const current = startOfManilaDay(now);
  if (current.getTime() <= target.getTime()) return 0;

  let count = 0;
  const cursor = new Date(target);
  while (cursor.getTime() < current.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) count += 1;
  }
  return count;
}

export function contributionCaseEscalationStage(
  caseRow: ContributionCaseLike,
  now: Date | string = new Date(),
): ContributionCaseEscalationStage {
  const service = contributionCaseServiceStatus(caseRow, now);
  if (!service.overdue || !service.targetDate) return 0;

  const overdueBusinessDays = businessDaysPastTarget(service.targetDate, now);
  if (overdueBusinessDays >= 5) return 3;
  if (overdueBusinessDays >= 2) return 2;
  return 1;
}
