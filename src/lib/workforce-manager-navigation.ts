export type WorkforceTimecardPeriod = { periodStart: string; periodEnd: string };

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}

/** Keep the last valid selected cutoff when a manager visits another WFM tool.
 * Dates are navigation context only; server-owned approvals and payroll locks
 * remain unchanged.
 */
export function rememberWfmTimecardPeriod(
  previous: WorkforceTimecardPeriod | undefined,
  candidate: WorkforceTimecardPeriod | undefined,
): WorkforceTimecardPeriod | undefined {
  if (!candidate || !validCalendarDate(candidate.periodStart) ||
      !validCalendarDate(candidate.periodEnd) ||
      candidate.periodStart > candidate.periodEnd) return previous;
  return { periodStart: candidate.periodStart, periodEnd: candidate.periodEnd };
}
