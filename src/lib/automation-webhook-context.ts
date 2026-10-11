/**
 * Default-minimum disclosure for org-configured automation webhook targets.
 * External destinations are not implicitly trusted with the event's internal
 * context. Each trigger has its own explicit outbound field set.
 *
 * A trigger absent from the registry sends no context.
 * No employee identifiers, amounts, bank details, government IDs, free-text
 * descriptions, health or disciplinary records leave this path.
 */
const WEBHOOK_CONTEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "employee.hired": ["effectiveDate"],
  "employee.updated": ["effectiveDate"],
  "employee.field_changed": ["effectiveDate"],
  "employee.moved": ["effectiveDate"],
  "employee.promoted": ["effectiveDate"],
  "employee.separated": ["effectiveDate"],
  "payroll.created": ["periodStart", "periodEnd", "payDate"],
  "payroll.submitted": ["periodStart", "periodEnd", "payDate"],
  "payroll.approved": ["periodStart", "periodEnd", "payDate"],
  "payroll.released": ["periodStart", "periodEnd", "payDate"],
  "payroll.pay_date_approaching": ["payDate"],
  "timesheet.cutoff_approaching": ["cutoffDate"],
  "timesheet.missing_approaching": ["cutoffDate"],
  "attendance.exception_created": ["workDate"],
  "attendance.exception_aging": ["workDate"],
  "attendance.clock_in_pending": ["workDate"],
  "coverage.gap_approaching": ["workDate"],
  "overtime.requested": ["workDate"],
  "overtime.approved": ["workDate"],
  "leave.requested": ["startDate", "endDate"],
  "leave.approved": ["startDate", "endDate"],
  "compensation.changed": ["effectiveDate"],
  "candidate.hired": ["effectiveDate"],
  "position.opened": ["effectiveDate"],
  "document.expires": ["expiryDate"],
  "government.remittance_due": ["dueDate"],
  "contribution.discrepancy_detected": ["applicableMonth"],
  "benefit.enrollment_created": ["effectiveDate"],
  "benefit.dependent_added": ["effectiveDate"],
  "benefit.coverage_activated": ["effectiveDate"],
  "benefit.coverage_ended": ["effectiveDate"],
};

/** Only YYYY-MM-DD or YYYY-MM can pass. No arbitrary free-text values. */
export function safeAutomationWebhookContext(
  trigger: string,
  context: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of WEBHOOK_CONTEXT_FIELDS[trigger] ?? []) {
    const value = context[key];
    if (typeof value !== "string") continue;
    if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) continue;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    if (year < 2000 || year > 2100 || month < 1 || month > 12) continue;
    if (value.length === 10 && (Number(value.slice(8, 10)) < 1 || Number(value.slice(8, 10)) > 31)) continue;
    result[key] = value;
  }
  return result;
}
