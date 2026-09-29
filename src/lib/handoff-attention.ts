import type { DashboardData, Employee, PayrollHandoffRunSummary, PayrollRun, Task } from "@/components/workspace/types";

export type HandoffAttentionTone = "review" | "active" | "danger" | "success";
export type HandoffAttentionFocus = "incomplete-attendance" | "payroll-exceptions" | "submit-review" | "release-payroll";

export type HandoffAttention = {
  id: string;
  title: string;
  detail: string;
  tone: HandoffAttentionTone;
  page: string;
  actionLabel: string;
  owner: "HR" | "Payroll" | "Checker" | "Owner";
  employeeId?: number;
  focus?: HandoffAttentionFocus;
};

type HandoffRun = PayrollRun | PayrollHandoffRunSummary;

export function buildHandoffAttention(data: DashboardData, role: string | null | undefined): HandoffAttention[] {
  const normalizedRole = normalizeAttentionRole(role);
  if (!normalizedRole) return [];

  const run = currentHandoffRun(data);
  const incompletePunches = (data.punches ?? []).filter((punch) => !punch.timeIn || !punch.timeOut);
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
  const missingIds = data.employees.filter((employee) => employee.status === "Active" && missingGovernmentIds(employee).length > 0);
  const payrollExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
  const linkedTask = run ? latestRunTask(data.tasks, run.id) : undefined;
  const items: HandoffAttention[] = [];

  if (normalizedRole === "hr") {
    if (incompletePunches.length > 0) {
      items.push({
        id: "hr-attendance",
        title: `${incompletePunches.length} attendance record${incompletePunches.length === 1 ? "" : "s"} need HR action`,
        detail: "Incomplete punches can reduce derived hours and block a clean payroll handoff.",
        tone: "danger",
        page: "Time & attendance",
        actionLabel: "Review attendance",
        owner: "HR",
        focus: "incomplete-attendance",
      });
    }
    if (pendingLeave.length > 0) {
      items.push({
        id: "hr-leave",
        title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} waiting on HR`,
        detail: "Resolve pending leave before Payroll treats the cutoff inputs as final.",
        tone: "review",
        page: "Leave",
        actionLabel: "Review leave",
        owner: "HR",
      });
    }
    if (missingIds.length > 0) {
      const first = missingIds[0];
      items.push({
        id: "hr-government-ids",
        title: `${missingIds.length} employee record${missingIds.length === 1 ? "" : "s"} missing filing IDs`,
        detail: `${employeeName(first)} is missing ${missingGovernmentIds(first).join(", ")}${missingIds.length > 1 ? `; plus ${missingIds.length - 1} more record(s)` : ""}.`,
        tone: "review",
        page: "People",
        actionLabel: "Fix employee record",
        owner: "HR",
        employeeId: first.id,
      });
    }
    return items;
  }

  if (normalizedRole === "payroll") {
    if (incompletePunches.length > 0) {
      items.push({
        id: "payroll-waiting-attendance",
        title: `Waiting on HR: ${incompletePunches.length} attendance issue${incompletePunches.length === 1 ? "" : "s"}`,
        detail: "Open the attendance exceptions before calculating or submitting the payroll.",
        tone: "danger",
        page: "Time & attendance",
        actionLabel: "Open attendance",
        owner: "HR",
        focus: "incomplete-attendance",
      });
    }
    if (pendingLeave.length > 0) {
      items.push({
        id: "payroll-waiting-leave",
        title: `Waiting on HR: ${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"}`,
        detail: "Payroll can see the dependency, but HR owns the leave decision.",
        tone: "review",
        page: "Overview",
        actionLabel: "View handoff",
        owner: "HR",
      });
    }
    if (missingIds.length > 0) {
      const first = missingIds[0];
      items.push({
        id: "payroll-waiting-ids",
        title: `Waiting on HR: ${missingIds.length} filing-ID gap${missingIds.length === 1 ? "" : "s"}`,
        detail: `${employeeName(first)} is missing ${missingGovernmentIds(first).join(", ")}${missingIds.length > 1 ? `; plus ${missingIds.length - 1} more record(s)` : ""}.`,
        tone: "review",
        page: "People",
        actionLabel: "Open employee",
        owner: "HR",
        employeeId: first.id,
      });
    }

    const hrBlockers = incompletePunches.length + pendingLeave.length + missingIds.length;
    if (!run || hrBlockers > 0) return items;

    if (run.status === "Failed") {
      items.push({
        id: `payroll-failed-${run.id}`,
        title: `Payroll calculation failed for ${run.periodLabel}`,
        detail: "Open the run, review the failure context and retry the calculation.",
        tone: "danger",
        page: "Payroll",
        actionLabel: "Open failed run",
        owner: "Payroll",
      });
      return items;
    }

    if (run.status === "Draft") {
      items.push({
        id: `payroll-start-${run.id}`,
        title: `HR handoff is clear for ${run.periodLabel}`,
        detail: "Attendance, leave and filing-ID blockers are clear. Payroll can prepare the register.",
        tone: "active",
        page: "Payroll",
        actionLabel: "Prepare payroll",
        owner: "Payroll",
      });
      return items;
    }

    if (run.status === "Needs review" || run.status === "Processed") {
      if (payrollExceptions.length > 0 || ("exceptions" in run && Number(run.exceptions) > 0)) {
        const count = payrollExceptions.length || ("exceptions" in run ? Number(run.exceptions) : 0);
        items.push({
          id: `payroll-exceptions-${run.id}`,
          title: `${count} payroll exception${count === 1 ? "" : "s"} must be resolved`,
          detail: "Review the flagged employee rows before handing the run to Checker.",
          tone: "danger",
          page: "Payroll",
          actionLabel: "Review exceptions",
          owner: "Payroll",
          focus: "payroll-exceptions",
        });
      } else {
        items.push({
          id: `payroll-submit-${run.id}`,
          title: `${run.periodLabel} is ready for Checker`,
          detail: "The register is calculated and the HR handoff is clear. Submit it for independent review.",
          tone: "active",
          page: "Payroll",
          actionLabel: "Submit for review",
          owner: "Payroll",
          focus: "submit-review",
        });
      }
      return items;
    }

    return items;
  }

  if (normalizedRole === "checker") {
    const pending = data.tasks.filter((task) => task.status === "Pending");
    for (const task of pending.slice(0, 3)) {
      items.push({
        id: `checker-task-${task.id}`,
        title: run && task.detail.includes(`Payroll run #${run.id}`)
          ? `${run.periodLabel} is ready for your review`
          : task.title,
        detail: `${task.detail} · ${task.dueLabel}`,
        tone: task.priority === "High" ? "danger" : "review",
        page: "Approvals",
        actionLabel: "Review now",
        owner: "Checker",
      });
    }
    return items;
  }

  if (normalizedRole === "owner") {
    if (run && run.status === "Ready for release" && linkedTask?.status === "Approved") {
      items.push({
        id: `owner-release-${run.id}`,
        title: `${run.periodLabel} is approved and ready to release`,
        detail: `${linkedTask.approver} completed the independent review. Owner release is the next control.`,
        tone: "active",
        page: "Payroll",
        actionLabel: "Release payroll",
        owner: "Owner",
        focus: "release-payroll",
      });
    }
    return items;
  }

  return items;
}

export function currentHandoffRun(data: DashboardData): HandoffRun | undefined {
  return data.payrollRuns.find((run) => run.status !== "Released")
    ?? data.payrollHandoffRun
    ?? data.payrollRuns[0];
}

export function latestRunTask(tasks: Task[], runId: number) {
  return tasks
    .filter((task) => task.detail.includes(`Payroll run #${runId}`))
    .sort((a, b) => b.id - a.id)[0];
}

export function missingGovernmentIds(employee: Employee) {
  return [
    !employee.tin ? "TIN" : null,
    !employee.sssNo ? "SSS" : null,
    !employee.philHealthNo ? "PhilHealth" : null,
    !employee.pagIbigNo ? "Pag-IBIG" : null,
  ].filter((value): value is string => Boolean(value));
}

function employeeName(employee: Employee) {
  return `${employee.firstName} ${employee.lastName}`;
}

function normalizeAttentionRole(role: string | null | undefined): "hr" | "payroll" | "checker" | "owner" | null {
  if (!role) return null;
  if (role === "hr") return "hr";
  if (role === "payroll" || role === "bookkeeper") return "payroll";
  if (role === "checker" || role === "manager") return "checker";
  if (role === "owner" || role === "admin") return "owner";
  return null;
}
