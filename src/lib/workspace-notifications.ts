import type { DashboardData } from "@/components/workspace/types";

export type WorkspaceNotification = {
  id: string;
  title: string;
  detail: string;
  at?: string | Date;
  tone: "review" | "active" | "danger" | "success";
  page?: string;
  actionLabel?: string;
};

export function buildNotifications(data: DashboardData, role?: string | null): WorkspaceNotification[] {
  const items: WorkspaceNotification[] = [];
  const effectiveRole = role ?? data.access?.role ?? data.user?.role ?? null;
  const liveRun = data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollRuns[0];
  const pendingTasks = data.tasks.filter((task) => task.status === "Pending");
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
  const attendanceIssues = (data.punches ?? []).filter((punch) => {
    const status = punch.status.toLowerCase();
    return !["complete", "present", "ok", "approved"].includes(status);
  });
  const peopleMissingGovernmentIds = data.employees.filter(
    (employee) =>
      employee.status === "Active" &&
      (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
  );

  if (effectiveRole === "hr") {
    if (pendingLeave.length) {
      items.push({
        id: "hr-pending-leave",
        title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} need HR review`,
        detail: "Clear leave decisions before Payroll locks the cutoff inputs.",
        tone: "review",
        page: "Leave",
        actionLabel: "Review leave",
      });
    }
    if (attendanceIssues.length) {
      items.push({
        id: "hr-attendance",
        title: `${attendanceIssues.length} attendance item${attendanceIssues.length === 1 ? "" : "s"} need context`,
        detail: "Resolve incomplete or non-standard punches before the payroll handoff.",
        tone: "danger",
        page: "Time & attendance",
        actionLabel: "Fix attendance",
      });
    }
    if (peopleMissingGovernmentIds.length) {
      items.push({
        id: "hr-government-ids",
        title: `${peopleMissingGovernmentIds.length} active employee record${peopleMissingGovernmentIds.length === 1 ? "" : "s"} missing filing IDs`,
        detail: "Complete TIN, SSS, PhilHealth or Pag-IBIG details before filing/export work.",
        tone: "review",
        page: "People",
        actionLabel: "Fix records",
      });
    }
    const openProvisioning = (data.provisioning ?? []).filter((item) => !item.done).length;
    if (openProvisioning) {
      items.push({
        id: "hr-provisioning",
        title: `${openProvisioning} lifecycle item${openProvisioning === 1 ? "" : "s"} still open`,
        detail: "Finish onboarding/offboarding work that affects the people record.",
        tone: "active",
        page: "People",
        actionLabel: "Open people",
      });
    }
    return items.slice(0, 6);
  }

  if (effectiveRole === "payroll") {
    if (attendanceIssues.length || peopleMissingGovernmentIds.length || pendingLeave.length) {
      const blockers = attendanceIssues.length + peopleMissingGovernmentIds.length + pendingLeave.length;
      items.push({
        id: "payroll-cutoff-blockers",
        title: `${blockers} upstream cutoff item${blockers === 1 ? "" : "s"} still unresolved`,
        detail: `${attendanceIssues.length} attendance · ${pendingLeave.length} leave · ${peopleMissingGovernmentIds.length} filing-ID issue(s). Review the source before finalizing payroll.`,
        tone: "danger",
        page: attendanceIssues.length ? "Time & attendance" : "People",
        actionLabel: "Review blockers",
      });
    }
    if (liveRun && ["Draft", "Processing", "Needs review", "Calculated"].includes(liveRun.status)) {
      items.push({
        id: `payroll-run-${liveRun.id}`,
        title: `${liveRun.periodLabel} needs Payroll action`,
        detail: liveRun.exceptions
          ? `${liveRun.exceptions} payroll exception(s) must be resolved before checker handoff.`
          : "Confirm cutoff inputs and submit the prepared register to Checker.",
        tone: liveRun.exceptions ? "danger" : "review",
        page: "Payroll",
        actionLabel: liveRun.exceptions ? "Resolve exceptions" : "Open payroll",
      });
    }
    return items.slice(0, 5);
  }

  if (effectiveRole === "checker") {
    for (const task of pendingTasks.slice(0, 5)) {
      items.push({
        id: `checker-task-${task.id}`,
        title: task.title,
        detail: `${task.detail} · ${task.dueLabel}`,
        tone: task.priority === "High" ? "danger" : "review",
        page: "Approvals",
        actionLabel: "Review decision",
      });
    }
    return items;
  }

  if (effectiveRole === "owner") {
    if (liveRun?.status === "Ready for release" || liveRun?.status === "Approved") {
      items.push({
        id: `owner-release-${liveRun.id}`,
        title: `${liveRun.periodLabel} is approved and ready to release`,
        detail: `${liveRun.employeeCount} employees · ${liveRun.exceptions} recorded exception(s). Final release remains an Owner/Admin action.`,
        tone: liveRun.exceptions ? "review" : "success",
        page: "Payroll",
        actionLabel: "Release payroll",
      });
    }
    for (const task of pendingTasks.slice(0, 3)) {
      items.push({
        id: `owner-task-${task.id}`,
        title: task.title,
        detail: `${task.detail} · ${task.dueLabel}`,
        tone: task.priority === "High" ? "danger" : "review",
        page: "Approvals",
        actionLabel: "Review decision",
      });
    }
    return items.slice(0, 5);
  }

  for (const task of pendingTasks.slice(0, 5)) {
    items.push({
      id: `task-${task.id}`,
      title: task.title,
      detail: `${task.detail} · ${task.dueLabel}`,
      tone: task.priority === "High" ? "danger" : "review",
      page: "Approvals",
      actionLabel: "Open",
    });
  }
  return items;
}
