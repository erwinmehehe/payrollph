import type { DashboardData } from "@/components/workspace/types";
import { payrollHandoffRank, type PayrollHandoffKey } from "@/lib/payroll-handoff";

export type PayrollAttentionTone = "review" | "danger" | "success" | "active";

export type PayrollAttentionItem = {
  id: string;
  role: Exclude<PayrollHandoffKey, "employee">;
  title: string;
  detail: string;
  tone: PayrollAttentionTone;
  page: string;
  actionLabel: string;
  employeeId?: number;
  timeFilter?: "incomplete";
};

export function selectPayrollHandoffRun(
  data: DashboardData,
  role: string | null | undefined,
) {
  const fullRuns = data.payrollRuns;
  const byRank = (rank: number) => fullRuns.find((run) => payrollHandoffRank(run.status) === rank);

  if (role === "checker") return byRank(2) ?? fullRuns.find((run) => run.status !== "Released") ?? data.payrollHandoffRun ?? fullRuns[0] ?? null;
  if (role === "owner") return byRank(3) ?? fullRuns.find((run) => run.status !== "Released") ?? data.payrollHandoffRun ?? fullRuns[0] ?? null;
  if (role === "payroll") return byRank(1) ?? fullRuns.find((run) => run.status !== "Released") ?? data.payrollHandoffRun ?? fullRuns[0] ?? null;
  if (role === "hr") return byRank(0) ?? data.payrollHandoffRun ?? fullRuns.find((run) => run.status !== "Released") ?? fullRuns[0] ?? null;

  return fullRuns.find((run) => run.status !== "Released") ?? data.payrollHandoffRun ?? fullRuns[0] ?? null;
}

export function buildPayrollAttention(
  data: DashboardData,
  role: string | null | undefined,
): PayrollAttentionItem[] {
  if (role !== "owner" && role !== "hr" && role !== "payroll" && role !== "checker") return [];

  const handoffRun = selectPayrollHandoffRun(data, role);
  if (!handoffRun) return [];

  const rank = payrollHandoffRank(handoffRun.status);
  const items: PayrollAttentionItem[] = [];

  if (role === "hr" && rank === 0) {
    const incompletePunches = (data.punches ?? []).filter(
      (punch) => !punch.timeIn || !punch.timeOut,
    );
    const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
    const missingIds = data.employees.filter(
      (employee) =>
        employee.status === "Active" &&
        (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
    );

    if (incompletePunches.length) {
      items.push({
        id: `hr-attendance-${handoffRun.id}`,
        role,
        title: `${incompletePunches.length} attendance item${incompletePunches.length === 1 ? "" : "s"} blocking cutoff`,
        detail: `${handoffRun.periodLabel} cannot be cleanly handed to Payroll until incomplete punches are reviewed.`,
        tone: "danger",
        page: "Time & attendance",
        actionLabel: "Fix attendance",
        timeFilter: "incomplete",
      });
    }

    if (pendingLeave.length) {
      items.push({
        id: `hr-leave-${handoffRun.id}`,
        role,
        title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} still pending`,
        detail: "Resolve leave decisions that can change paid days before Payroll takes the cutoff.",
        tone: "review",
        page: "Leave",
        actionLabel: "Review leave",
      });
    }

    if (missingIds.length) {
      const employee = missingIds[0];
      items.push({
        id: `hr-ids-${handoffRun.id}`,
        role,
        title: `${missingIds.length} active employee record${missingIds.length === 1 ? "" : "s"} missing filing IDs`,
        detail: `Start with ${employee.firstName} ${employee.lastName}; complete TIN/SSS/PhilHealth/Pag-IBIG data before filing exports.`,
        tone: "review",
        page: "People",
        actionLabel: "Open employee",
        employeeId: employee.id,
      });
    }

    return items;
  }

  if (role === "payroll" && rank === 1) {
    const exceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
    const failedJobs = (data.payrollJobs ?? []).filter((job) => job.status === "Failed");

    if (failedJobs.length) {
      items.push({
        id: `payroll-job-${handoffRun.id}`,
        role,
        title: `${failedJobs.length} payroll calculation job${failedJobs.length === 1 ? "" : "s"} failed`,
        detail: "Re-run the payroll calculation before the register can move to Checker.",
        tone: "danger",
        page: "Payroll",
        actionLabel: "Open payroll",
      });
      return items;
    }

    if (exceptions.length) {
      items.push({
        id: `payroll-exceptions-${handoffRun.id}`,
        role,
        title: `${exceptions.length} payroll exception${exceptions.length === 1 ? "" : "s"} need review`,
        detail: `Resolve the flagged ${handoffRun.periodLabel} entries before submitting to the independent checker.`,
        tone: "danger",
        page: "Payroll",
        actionLabel: "Review exceptions",
      });
      return items;
    }

    items.push({
      id: `payroll-submit-${handoffRun.id}`,
      role,
      title: "Payroll is ready for checker handoff",
      detail: `${handoffRun.periodLabel} has no visible register exceptions. Submit it for independent review.`,
      tone: "active",
      page: "Payroll",
      actionLabel: "Submit for review",
    });
    return items;
  }

  if (role === "checker" && rank === 2) {
    const task = data.tasks
      .filter(
        (item) =>
          item.status === "Pending" &&
          item.detail.includes(`Payroll run #${handoffRun.id}`),
      )
      .sort((a, b) => b.id - a.id)[0];

    if (task) {
      items.push({
        id: `checker-review-${handoffRun.id}-${task.id}`,
        role,
        title: "Payroll is ready for independent review",
        detail: `${handoffRun.periodLabel} is assigned to ${task.approver}. Review the evidence and record a decision.`,
        tone: task.priority === "High" ? "danger" : "review",
        page: "Approvals",
        actionLabel: "Review payroll",
      });
    }
    return items;
  }

  if (role === "owner" && rank === 3) {
    items.push({
      id: `owner-release-${handoffRun.id}`,
      role,
      title: "Payroll is approved and ready to release",
      detail: `${handoffRun.periodLabel} cleared independent review. Owner/admin release is the final control before payslips become available.`,
      tone: "active",
      page: "Payroll",
      actionLabel: "Release payroll",
    });
  }

  return items;
}
