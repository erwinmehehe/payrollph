import { dashboardPayrollSummary } from "@/lib/dashboard-presentation";
import { isPreliminaryPayroll, manilaCalendarDate } from "@/lib/payroll-period-ui";
import { buildOwnerReleaseSummary } from "@/lib/owner-release-summary";
import type { DashboardData, PayrollRun } from "@/components/workspace/types";

export type PremiumIssue = {
  id: "attendance" | "exceptions" | "records";
  count: number;
  title: string;
  description: string;
  page: "Time & attendance" | "Payroll" | "People";
  tone: "warning" | "danger";
};

/**
 * Read-only dashboard presentation, never a substitute for the server-side
 * payroll assurance, statutory calculations or release authorization gates.
 */
export function buildPremiumDashboardModel(
  data: DashboardData,
  run?: PayrollRun,
  now: Date = new Date(),
) {
  const activePeople = data.employees.filter((person) => person.status === "Active");
  const inPeriod = (workDate: string) =>
    !run || (workDate >= run.periodStart && workDate <= run.periodEnd);
  const openAttendance = (data.punches ?? []).filter(
    (punch) =>
      inPeriod(punch.workDate) &&
      !["complete", "present", "ok", "approved"].includes(punch.status.toLowerCase()),
  );
  const attendanceEmployees = new Set(openAttendance.map((punch) => punch.employeeId)).size;
  const missingRecords = activePeople.filter(
    (person) =>
      !person.bankCode ||
      !person.bankAccount ||
      !person.tin ||
      !person.sssNo ||
      !person.philHealthNo ||
      !person.pagIbigNo,
  ).length;
  const pendingTasks = data.tasks.filter((task) => task.status === "Pending");
  const pendingLeave = (data.leaveRequests ?? []).filter((leave) => leave.status === "Pending").length;
  const summary = dashboardPayrollSummary(run, 0);
  const exceptions = summary.calculated ? Math.max(0, run?.exceptions ?? 0) : 0;

  // Never use a partial trace as though it were a complete employer cost total.
  // The full release screen still supplies the authoritative breakdown.
  const entriesComplete = Boolean(
    run &&
    summary.calculated &&
    data.payrollEntries.length === run.employeeCount &&
    new Set(data.payrollEntries.map((entry) => entry.employeeId)).size === run.employeeCount &&
    run.employeeCount > 0,
  );
  const employerSummary = entriesComplete && run
    ? buildOwnerReleaseSummary({
        runStatus: run.status,
        grossPay: run.grossPay,
        netPay: run.netPay,
        entries: data.payrollEntries,
      })
    : null;
  const employerCosts = employerSummary?.employerStatutoryCost ?? null;
  const totalCost = employerSummary?.totalFundingRequirement ?? null;

  const issues: PremiumIssue[] = [];
  if (attendanceEmployees) {
    issues.push({
      id: "attendance",
      count: attendanceEmployees,
      title: attendanceEmployees + " employee" + (attendanceEmployees === 1 ? "" : "s") + " with attendance to review",
      description: "Check the time entries recorded for this pay period.",
      page: "Time & attendance",
      tone: "warning",
    });
  }
  if (exceptions) {
    issues.push({
      id: "exceptions",
      count: exceptions,
      title: exceptions + " payroll exception" + (exceptions === 1 ? "" : "s"),
      description: "Inspect flagged entries and their calculation traces.",
      page: "Payroll",
      tone: "danger",
    });
  }
  if (missingRecords) {
    issues.push({
      id: "records",
      count: missingRecords,
      title: missingRecords + " employee record" + (missingRecords === 1 ? "" : "s") + " to complete",
      description: "Payout or government identifiers are missing.",
      page: "People",
      tone: "warning",
    });
  }

  const scheduledDates: Array<{ key: string; label: string; date: string; page: string }> = [];
  if (run?.periodEnd) {
    scheduledDates.push({
      key: "cutoff",
      label: "Payroll period ends",
      date: run.periodEnd,
      page: "Payroll",
    });
  }
  if (run?.payDate) {
    scheduledDates.push({
      key: "payday",
      label: "Scheduled payday",
      date: run.payDate,
      page: "Payroll",
    });
  }
  const complianceItems = (data.complianceActions ?? [])
    .filter((action) => action.status !== "resolved")
    .filter((action) => typeof action.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(action.dueDate))
    .slice()
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 3);
  for (const action of complianceItems) {
    scheduledDates.push({
      key: "compliance-" + action.id,
      label: action.title,
      date: String(action.dueDate),
      page: "Compliance",
    });
  }
  scheduledDates.sort((a, b) => a.date.localeCompare(b.date));

  return {
    activeCount: activePeople.length,
    totalCount: data.employees.length,
    payrollEmployeeCount: run?.employeeCount ?? null,
    pendingApprovals: pendingTasks.length,
    pendingLeave,
    attendanceEmployees,
    missingRecords,
    exceptions,
    issues,
    scheduledDates: scheduledDates.filter((item) => item.date >= manilaCalendarDate(now)).slice(0, 4),
    calculated: summary.calculated,
    preliminary: Boolean(run && isPreliminaryPayroll(run.periodEnd, summary.calculated, now)),
    gross: summary.gross,
    net: summary.net,
    deductions: summary.deductions,
    employerCosts,
    totalCost,
    employerCostComplete: employerCosts !== null,
  };
}
