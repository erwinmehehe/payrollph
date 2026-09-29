import type { DashboardData, Task } from "@/components/workspace/types";

export type ActionRole = "owner" | "hr" | "payroll" | "checker";

export type PayrollActionItem = {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  page: string;
  tone: "review" | "active" | "danger" | "success";
  blocking?: boolean;
};

export function actionableRole(role: string | null | undefined): ActionRole | null {
  return role === "owner" || role === "hr" || role === "payroll" || role === "checker" ? role : null;
}

export function getPayrollActions(data: DashboardData, explicitRole?: string | null): PayrollActionItem[] {
  const role = actionableRole(explicitRole ?? data.access?.role ?? data.user?.role);
  if (!role) return [];

  if (role === "hr") return hrActions(data);
  if (role === "payroll") return payrollActions(data);
  if (role === "checker") return checkerActions(data);
  return ownerActions(data);
}

function hrActions(data: DashboardData): PayrollActionItem[] {
  const actions: PayrollActionItem[] = [];
  const run = currentCutoffRun(data);
  const { pendingLeave, incompletePunches, missingIds } = cutoffBlockers(data, run);

  if (pendingLeave.length) {
    actions.push({
      id: "hr-leave",
      title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} still need a decision`,
      detail: `Pending leave can change payable days${run ? ` in ${run.periodLabel}` : ""}. Review the linked approval before Payroll closes the cutoff.`,
      actionLabel: "Review leave approvals",
      page: "Approvals",
      tone: "review",
      blocking: true,
    });
  }

  if (incompletePunches.length) {
    const affected = new Set(incompletePunches.map((punch) => punch.employeeId)).size;
    actions.push({
      id: "hr-attendance",
      title: `${incompletePunches.length} incomplete punch${incompletePunches.length === 1 ? "" : "es"} across ${affected} employee${affected === 1 ? "" : "s"}`,
      detail: `Incomplete time records${run ? ` inside ${run.periodLabel}` : ""} derive zero hours during payroll calculation until corrected.`,
      actionLabel: "Review attendance",
      page: "Time & attendance",
      tone: "danger",
      blocking: true,
    });
  }

  if (missingIds.length) {
    const names = missingIds
      .slice(0, 3)
      .map((employee) => `${employee.firstName} ${employee.lastName}`)
      .join(", ");
    actions.push({
      id: "hr-government-ids",
      title: `${missingIds.length} active employee${missingIds.length === 1 ? "" : "s"} have incomplete filing IDs`,
      detail: `${names}${missingIds.length > 3 ? ` +${missingIds.length - 3} more` : ""}. Complete TIN, SSS, PhilHealth and Pag-IBIG identifiers before filing exports.`,
      actionLabel: "Complete people records",
      page: "People",
      tone: "review",
      blocking: false,
    });
  }

  return actions;
}

function payrollActions(data: DashboardData): PayrollActionItem[] {
  const makerStatuses = new Set(["Failed", "Needs review", "Draft", "Calculated", "Ready"]);
  const run = data.payrollRuns.find((candidate) => makerStatuses.has(candidate.status)) ?? null;
  if (!run) return [];
  const task = latestRunTask(data.tasks, run.id);
  const { pendingLeave, incompletePunches } = cutoffBlockers(data, run);

  if (run.status === "Failed") {
    return [{
      id: "payroll-failed-" + run.id,
      title: run.periodLabel + " calculation failed",
      detail: "The run needs to be recalculated before it can return to checker review.",
      actionLabel: "Open failed run",
      page: "Payroll",
      tone: "danger",
      blocking: true,
    }];
  }

  const actions: PayrollActionItem[] = [];

  if (pendingLeave.length) {
    actions.push({
      id: "payroll-review-leave-" + run.id,
      title: pendingLeave.length + " leave request" + (pendingLeave.length === 1 ? "" : "s") + " overlap this cutoff",
      detail: "HR still has pending leave in " + run.periodLabel + ". Review the approval status before finalizing the register.",
      actionLabel: "View approval status",
      page: "Approvals",
      tone: "review",
    });
  }

  if (incompletePunches.length) {
    const affected = new Set(incompletePunches.map((punch) => punch.employeeId)).size;
    actions.push({
      id: "payroll-review-attendance-" + run.id,
      title: incompletePunches.length + " incomplete punch" + (incompletePunches.length === 1 ? "" : "es") + " affect this cutoff",
      detail: affected + " employee" + (affected === 1 ? "" : "s") + " in " + run.periodLabel + " still have incomplete time records. HR owns the correction.",
      actionLabel: "Inspect attendance",
      page: "Time & attendance",
      tone: "danger",
      blocking: true,
    });
  }

  if (run.exceptions > 0) {
    actions.push({
      id: "payroll-exceptions-" + run.id,
      title: run.exceptions + " payroll exception" + (run.exceptions === 1 ? "" : "s") + " need review",
      detail: run.periodLabel + " has flagged register entries. Resolve them or carry them into independent review with clear evidence.",
      actionLabel: "Review payroll exceptions",
      page: "Payroll",
      tone: "danger",
      blocking: true,
    });
  }

  if (task?.status === "Declined") {
    actions.push({
      id: "payroll-declined-" + run.id,
      title: run.periodLabel + " was returned by the checker",
      detail: "Review the returned payroll, recalculate if inputs changed, then submit a fresh independent review.",
      actionLabel: "Fix and resubmit",
      page: "Payroll",
      tone: "danger",
      blocking: true,
    });
  }

  if (actions.length) return actions;

  if (run.status === "Needs review" || run.status === "Draft" || run.status === "Calculated" || run.status === "Ready") {
    return [{
      id: "payroll-submit-" + run.id,
      title: run.periodLabel + " is ready for checker handoff",
      detail: "No current cutoff input warnings or stored payroll exceptions remain. Choose an independent checker and submit the run for review.",
      actionLabel: "Submit to checker",
      page: "Payroll",
      tone: "active",
    }];
  }

  return [];
}

function checkerActions(data: DashboardData): PayrollActionItem[] {
  const pendingTasks = data.tasks
    .filter((task) => task.status === "Pending")
    .sort((a, b) => (a.priority === "High" ? -1 : 1) - (b.priority === "High" ? -1 : 1));

  for (const task of pendingTasks) {
    const match = task.detail.match(/Payroll run #(\d+)/);
    if (!match) continue;
    const run = data.payrollRuns.find((candidate) => candidate.id === Number(match[1]));
    if (!run || run.status !== "Pending approval") continue;
    return [{
      id: `checker-review-${task.id}`,
      title: `${run.periodLabel} is waiting for your review`,
      detail: `${task.title}. Inspect payroll context and assurance before approving or declining.`,
      actionLabel: "Review payroll",
      page: "Approvals",
      tone: task.priority === "High" ? "danger" : "review",
    }];
  }

  return [];
}

function ownerActions(data: DashboardData): PayrollActionItem[] {
  for (const run of data.payrollRuns.filter((candidate) => candidate.status === "Ready for release")) {
    const task = latestRunTask(data.tasks, run.id);
    if (task?.status !== "Approved") continue;
    return [{
      id: `owner-release-${run.id}`,
      title: `${run.periodLabel} is approved and ready to release`,
      detail: "Independent checker approval is complete. Review the release checklist and confirm the payroll release.",
      actionLabel: "Release payroll",
      page: "Payroll",
      tone: "success",
    }];
  }

  return [];
}

function currentCutoffRun(data: DashboardData) {
  return data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollHandoffRun ?? null;
}

function cutoffBlockers(
  data: DashboardData,
  run: { periodStart?: string; periodEnd?: string } | null,
) {
  const start = run?.periodStart;
  const end = run?.periodEnd;
  const within = (date: string) => !start || !end || (date >= start && date <= end);
  const overlaps = (startDate: string, endDate: string) =>
    !start || !end || (startDate <= end && endDate >= start);

  const pendingLeave = (data.leaveRequests ?? []).filter(
    (request) => request.status === "Pending" && overlaps(request.startDate, request.endDate),
  );
  const incompletePunches = (data.punches ?? []).filter(
    (punch) => (!punch.timeIn || !punch.timeOut) && within(punch.workDate),
  );
  const missingIds = data.employees.filter(
    (employee) =>
      employee.status === "Active" &&
      (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
  );

  return { pendingLeave, incompletePunches, missingIds };
}

function latestRunTask(tasks: Task[], runId: number): Task | null {
  return tasks
    .filter((task) => task.detail.includes(`Payroll run #${runId}`))
    .sort((a, b) => b.id - a.id)[0] ?? null;
}
