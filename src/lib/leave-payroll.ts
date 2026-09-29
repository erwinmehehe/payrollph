export type LeavePayTreatment = "paid" | "unpaid" | "partial" | "unconfigured";

export type PayrollLeaveRequest = {
  id: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
};

export type PayrollLeavePolicy = {
  leaveType: string;
  payTreatment: string;
  paidPercentage: number;
};

export type ResolvedPayrollLeave = PayrollLeaveRequest & {
  overlapDays: number;
  paidPercentage: number;
  paidDays: number;
  unpaidDays: number;
  payTreatment: Exclude<LeavePayTreatment, "unconfigured">;
};

function isoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid leave date "${value}".`);
  }
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = isoDay(startDate);
  const end = isoDay(endDate);
  if (end < start) throw new Error("Leave end date cannot be before the start date.");
  return Math.floor((end - start) / 86_400_000) + 1;
}

function roundDays(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Leave requests store one total day count for a date range. When a request
 * crosses a payroll cutoff, there is no per-date allocation to read, so the
 * only deterministic split is proportional to the calendar overlap. Requests
 * fully inside a cutoff keep their exact entered day count.
 */
export function allocateLeaveDaysToPeriod(
  leave: PayrollLeaveRequest,
  periodStart: string,
  periodEnd: string,
) {
  if (!Number.isFinite(leave.days) || leave.days <= 0) {
    throw new Error(`Leave request #${leave.id} has an invalid day count.`);
  }

  const requestStart = isoDay(leave.startDate);
  const requestEnd = isoDay(leave.endDate);
  const cutoffStart = isoDay(periodStart);
  const cutoffEnd = isoDay(periodEnd);
  if (requestEnd < requestStart) {
    throw new Error(`Leave request #${leave.id} ends before it starts.`);
  }
  if (cutoffEnd < cutoffStart) {
    throw new Error("Payroll cutoff ends before it starts.");
  }

  const overlapStart = Math.max(requestStart, cutoffStart);
  const overlapEnd = Math.min(requestEnd, cutoffEnd);
  if (overlapEnd < overlapStart) return 0;

  if (requestStart >= cutoffStart && requestEnd <= cutoffEnd) {
    return roundDays(leave.days);
  }

  const totalCalendarDays = inclusiveDays(leave.startDate, leave.endDate);
  const overlapCalendarDays = Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1;
  return roundDays(leave.days * (overlapCalendarDays / totalCalendarDays));
}

export function resolveApprovedLeaveForPayroll(input: {
  requests: PayrollLeaveRequest[];
  policies: PayrollLeavePolicy[];
  periodStart: string;
  periodEnd: string;
}) {
  const policiesByType = new Map(
    input.policies.map((policy) => [policy.leaveType.trim().toLowerCase(), policy]),
  );

  return input.requests.flatMap<ResolvedPayrollLeave>((request) => {
    const overlapDays = allocateLeaveDaysToPeriod(request, input.periodStart, input.periodEnd);
    if (overlapDays <= 0) return [];

    const policy = policiesByType.get(request.leaveType.trim().toLowerCase());
    if (!policy) {
      throw new Error(
        `Approved ${request.leaveType} leave #${request.id} has no leave policy. Configure its payroll treatment before calculating payroll.`,
      );
    }

    const treatment = policy.payTreatment.trim().toLowerCase() as LeavePayTreatment;
    if (!["paid", "unpaid", "partial"].includes(treatment)) {
      throw new Error(
        `Approved ${request.leaveType} leave #${request.id} has no configured payroll treatment. Set it to Paid, Unpaid, or Partially paid before calculating payroll.`,
      );
    }

    const configuredTreatment = treatment as Exclude<LeavePayTreatment, "unconfigured">;
    const paidPercentage =
      configuredTreatment === "paid"
        ? 100
        : configuredTreatment === "unpaid"
          ? 0
          : Number(policy.paidPercentage);

    if (
      !Number.isFinite(paidPercentage) ||
      paidPercentage < 0 ||
      paidPercentage > 100 ||
      (configuredTreatment === "partial" && (paidPercentage <= 0 || paidPercentage >= 100))
    ) {
      throw new Error(
        `Leave policy "${policy.leaveType}" has an invalid paid percentage for ${configuredTreatment} leave.`,
      );
    }

    const paidDays = roundDays(overlapDays * (paidPercentage / 100));
    const unpaidDays = roundDays(overlapDays - paidDays);

    return [{
      ...request,
      overlapDays,
      paidPercentage,
      paidDays,
      unpaidDays,
      payTreatment: configuredTreatment,
    }];
  });
}

export function leaveRangeContainsDate(
  leave: Pick<PayrollLeaveRequest, "startDate" | "endDate">,
  date: string,
) {
  return date >= leave.startDate && date <= leave.endDate;
}
