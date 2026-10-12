/** Internal HR service targets; not statutory response deadlines. */
export const HR_CASE_TYPES = {
  coe: { assignedRole: "hr", slaHours: 72, label: "Certificate of Employment" },
  payslip_correction: { assignedRole: "payroll", slaHours: 48, label: "Payslip correction" },
  bir_2316: { assignedRole: "payroll", slaHours: 72, label: "BIR Form 2316 copy" },
  dispute: { assignedRole: "hr", slaHours: 48, label: "Workplace dispute" },
  general: { assignedRole: "hr", slaHours: 120, label: "General HR request" },
} as const;

export type HrCaseType = keyof typeof HR_CASE_TYPES;
export type HrCaseStatus = "open" | "in_progress" | "waiting_employee" | "resolved" | "closed";

export function isHrCaseType(value: unknown): value is HrCaseType {
  return typeof value === "string" && Object.hasOwn(HR_CASE_TYPES, value);
}

export function hrCaseDueAt(caseType: HrCaseType, startedAt: Date): Date {
  if (!Number.isFinite(startedAt.getTime())) throw new Error("Invalid SLA start");
  return new Date(startedAt.getTime() + HR_CASE_TYPES[caseType].slaHours * 3_600_000);
}

export function hrCaseSlaStatus(dueAt: Date | string, status: string, now: Date = new Date()) {
  const due = new Date(dueAt).getTime();
  const hoursRemaining = Math.ceil((due - now.getTime()) / 3_600_000);
  return {
    hoursRemaining,
    overdue: ["open", "in_progress", "waiting_employee"].includes(status) && hoursRemaining < 0,
  };
}

/** A resolved COE needs independently signed human approval and a document. */
export function hrCaseTransitionAllowed(
  current: HrCaseStatus,
  next: HrCaseStatus,
  type: HrCaseType,
  hasApprovedCoe: boolean,
): boolean {
  if (current === "closed" || current === next) return false;
  const allowed: Record<HrCaseStatus, HrCaseStatus[]> = {
    open: ["in_progress", "waiting_employee", "resolved"],
    in_progress: ["waiting_employee", "resolved"],
    waiting_employee: ["in_progress", "resolved"],
    resolved: ["closed", "in_progress"],
    closed: [],
  };
  if (!allowed[current].includes(next)) return false;
  return !(type === "coe" && ["resolved", "closed"].includes(next) && !hasApprovedCoe);
}

/**
 * Deliberately simple unsigned-content template: signed-off status is captured
 * separately in the approval ledger, with verified document hash on retrieval.
 */
export function approvedCoeText(input: {
  employerName: string;
  employeeName: string;
  employeeTitle: string;
  startDate: string;
  approvedBy: string;
  approvedDate: string;
}): string {
  for (const value of Object.values(input)) {
    if (!value.trim() || /[\r\n\x00-\x1f]/.test(value)) throw new Error("Invalid COE template data");
  }
  return [
    "CERTIFICATE OF EMPLOYMENT",
    "",
    "This is to certify that " + input.employeeName + " has been employed by " +
      input.employerName + " since " + input.startDate + " as " + input.employeeTitle + ".",
    "",
    "Issued upon the employee's request on " + input.approvedDate + ".",
    "Reviewed and approved by: " + input.approvedBy,
    "",
    "This document is for employment verification. It does not certify compensation.",
    "",
  ].join("\n");
}
