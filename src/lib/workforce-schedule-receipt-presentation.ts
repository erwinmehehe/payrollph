import type { ScheduleReceiptDay } from "./workforce-schedule-receipt";

/**
 * Browser-only presentation of an already validated, employee-scoped receipt
 * response. This is not notice delivery, attendance, payroll or a compliance
 * finding. Do not infer a missing receipt is worker misconduct.
 */
export function summarizeEmployeeReceiptDays(days: readonly ScheduleReceiptDay[]) {
  const counts = { acknowledged: 0, pending: 0, changed: 0, unavailable: 0 };
  for (const day of days) {
    switch (day.state) {
      case "acknowledged": counts.acknowledged++; break;
      case "pending": counts.pending++; break;
      case "changed": counts.changed++; break;
      case "unavailable": counts.unavailable++; break;
      default: throw new Error("Unrecognized schedule receipt state.");
    }
  }
  return { ...counts, requiresReview: counts.pending + counts.changed };
}

/** Show only days needing attention in the employee's compact Time workspace. */
export function visibleEmployeeReceiptDays(days: readonly ScheduleReceiptDay[], compact: boolean) {
  return compact ? days.filter(day => day.state !== "acknowledged") : [...days];
}
