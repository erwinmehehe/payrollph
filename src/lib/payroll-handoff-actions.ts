import type { DashboardData, PayrollHandoffRunSummary, PayrollRun, Task } from "@/components/workspace/types";
import { payrollHandoffRank } from "@/lib/payroll-handoff";

export type CompanyHandoffRole = "owner" | "hr" | "payroll" | "checker";
export type HandoffActionTone = "review" | "active" | "danger" | "success" | "muted";

export type HandoffActionItem = {
  id: string;
  title: string;
  detail: string;
  page: string;
  tone: Exclude<HandoffActionTone, "muted">;
  employeeId?: number;
};

export type RoleHandoffAction = {
  state: "action" | "waiting" | "complete";
  kicker: string;
  title: string;
  detail: string;
  page?: string;
  cta?: string;
  tone: HandoffActionTone;
  items: HandoffActionItem[];
};

export type PayrollHandoffContext = {
  run: PayrollRun | PayrollHandoffRunSummary | null;
  approval: Task | null;
  attendanceIssues: number;
  pendingLeave: number;
  missingGovernmentIds: number;
  hrBlockers: number;
  payrollExceptions: number;
};

export function selectHandoffRunForRole(
  data: DashboardData,
  role: CompanyHandoffRole,
): PayrollRun | PayrollHandoffRunSummary | null {
  const active = data.payrollRuns.filter((run) => run.status !== "Released");

  if (role === "checker") {
    return (
      active.find((run) => run.status === "Pending approval") ??
      active.find((run) => run.status === "Ready for release") ??
      active[0] ??
      data.payrollHandoffRun ??
      data.payrollRuns[0] ??
      null
    );
  }

  if (role === "owner") {
    return (
      active.find((run) => run.status === "Ready for release" || run.status === "Releasing") ??
      active.find((run) => run.status === "Pending approval") ??
      active[0] ??
      data.payrollHandoffRun ??
      data.payrollRuns[0] ??
      null
    );
  }

  if (role === "hr") {
    return data.payrollHandoffRun ?? active[0] ?? data.payrollRuns[0] ?? null;
  }

  return (
    active.find((run) =>
      ["Failed", "Needs review", "Recalculating", "Processing", "Queued", "Calculating", "Calculated", "Draft"].includes(run.status),
    ) ??
    active[0] ??
    data.payrollHandoffRun ??
    data.payrollRuns[0] ??
    null
  );
}

export function getPayrollHandoffContext(
  data: DashboardData,
  role: CompanyHandoffRole,
): PayrollHandoffContext {
  const run = selectHandoffRunForRole(data, role);

  const approval = run
    ? data.tasks
        .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
        .sort((a, b) => b.id - a.id)[0] ?? null
    : null;

  const attendanceIssues = (data.punches ?? []).filter(
    (punch) => inRunPeriod(punch.workDate, run) && (!punch.timeIn || !punch.timeOut),
  ).length;
  const pendingLeave = (data.leaveRequests ?? []).filter(
    (request) =>
      request.status === "Pending" &&
      overlapsRunPeriod(request.startDate, request.endDate, run),
  ).length;
  const missingGovernmentIds = data.employees.filter(
    (employee) =>
      employee.status === "Active" &&
      (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
  ).length;
  const payrollExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception").length;

  return {
    run,
    approval,
    attendanceIssues,
    pendingLeave,
    missingGovernmentIds,
    hrBlockers: attendanceIssues + pendingLeave + missingGovernmentIds,
    payrollExceptions,
  };
}

export function buildRoleHandoffAction(
  data: DashboardData,
  role: CompanyHandoffRole,
): RoleHandoffAction {
  const context = getPayrollHandoffContext(data, role);
  const { run, approval } = context;

  if (!run) {
    if (role === "payroll" || role === "owner") {
      return {
        state: "action",
        kicker: "Next handoff",
        title: "Start the next payroll run",
        detail: "There is no active payroll cycle in this workspace.",
        page: "Payroll",
        cta: "Open payroll",
        tone: "active",
        items: [],
      };
    }
    return waiting("No active payroll cycle", "The next handoff will appear when a payroll run is created.");
  }

  const rank = payrollHandoffRank(run.status);

  if (role === "hr") return buildHrAction(data, context, rank);
  if (role === "payroll") return buildPayrollAction(context, rank);
  if (role === "checker") return buildCheckerAction(context, rank);
  return buildOwnerAction(context, rank);
}

export function buildHandoffNotifications(
  data: DashboardData,
  role: string | null | undefined,
): HandoffActionItem[] {
  const handoffRole = notificationRoleFor(data, role);
  if (!handoffRole) return [];
  const action = buildRoleHandoffAction(data, handoffRole);
  if (action.state !== "action") return [];

  if (action.items.length) return action.items;

  if (!action.page) return [];
  const context = getPayrollHandoffContext(data, handoffRole);
  return [{
    id: `handoff-${handoffRole}-${context.run?.id ?? "none"}-${slug(action.title)}`,
    title: action.title,
    detail: action.detail,
    page: action.page,
    tone: action.tone === "danger" ? "danger" : action.tone === "success" ? "success" : action.tone === "active" ? "active" : "review",
  }];
}

function buildHrAction(
  data: DashboardData,
  context: PayrollHandoffContext,
  rank: number,
): RoleHandoffAction {
  if (rank > 1) {
    return waiting(
      "HR handoff is locked",
      `${context.run?.periodLabel ?? "This payroll"} has already moved to ${currentOwner(rank)}. Return it for changes before editing cutoff inputs.`,
    );
  }

  const items: HandoffActionItem[] = [];
  if (context.attendanceIssues > 0) {
    const names = namesForPunchIssues(data, context.run);
    items.push({
      id: `hr-attendance-${context.run?.id ?? "none"}`,
      title: `${context.attendanceIssues} attendance issue${context.attendanceIssues === 1 ? "" : "s"} block payroll`,
      detail: names.length ? `Review ${names.join(", ")} before Payroll prepares the run.` : "Review incomplete or non-standard punches before Payroll prepares the run.",
      page: "Time & attendance",
      tone: "danger",
    });
  }

  if (context.pendingLeave > 0) {
    const names = namesForPendingLeave(data, context.run);
    items.push({
      id: `hr-leave-${context.run?.id ?? "none"}`,
      title: `${context.pendingLeave} leave request${context.pendingLeave === 1 ? "" : "s"} still pending`,
      detail: names.length ? `Decide ${names.join(", ")} before the cutoff is handed to Payroll.` : "Review pending leave before the cutoff is handed to Payroll.",
      page: "Leave",
      tone: "review",
    });
  }

  if (context.missingGovernmentIds > 0) {
    const affected = employeesMissingGovernmentIds(data);
    items.push({
      id: `hr-identifiers-${context.run?.id ?? "none"}`,
      title: `${context.missingGovernmentIds} employee record${context.missingGovernmentIds === 1 ? "" : "s"} need filing IDs`,
      detail: affected.length
        ? affected.slice(0, 3).map((employee) => `${employee.name}: ${employee.missing.join(", ")}`).join(" · ")
        : "Complete missing TIN, SSS, PhilHealth or Pag-IBIG identifiers.",
      page: "People",
      tone: "review",
      employeeId: affected[0]?.id,
    });
  }

  if (items.length) {
    return {
      state: "action",
      kicker: "Your next action",
      title: `Clear ${context.hrBlockers} cutoff blocker${context.hrBlockers === 1 ? "" : "s"}`,
      detail: "These are the remaining HR inputs that can affect the next payroll. Open a blocker below to resolve it at the source.",
      page: items[0].page,
      cta: "Open first blocker",
      tone: "danger",
      items,
    };
  }

  return {
    state: "complete",
    kicker: "HR handoff",
    title: "Cutoff inputs are clear for Payroll",
    detail: "Attendance, leave and core filing identifiers have no visible blockers for this cycle.",
    tone: "success",
    items: [],
  };
}

function buildPayrollAction(context: PayrollHandoffContext, rank: number): RoleHandoffAction {
  const status = context.run?.status ?? "";

  if (status === "Failed") {
    return {
      state: "action",
      kicker: "Your next action",
      title: "Payroll calculation failed",
      detail: "Open the run, review the failure context and retry calculation before anything is handed to Checker.",
      page: "Payroll",
      cta: "Open failed run",
      tone: "danger",
      items: [],
    };
  }

  if (rank >= 2) {
    return waiting(
      rank === 2 ? "Waiting on Checker" : rank === 3 ? "Waiting on Owner" : "Payroll handoff complete",
      rank === 2
        ? "The submitted register is with an independent checker."
        : rank === 3
          ? "Checker approval is complete and release now belongs to Owner."
          : "The payroll has been released to employees.",
    );
  }

  if (rank === 0 && context.hrBlockers > 0) {
    return waiting(
      "Waiting on HR",
      `${context.hrBlockers} cutoff blocker${context.hrBlockers === 1 ? "" : "s"} still need HR attention before Payroll prepares the run.`,
    );
  }

  if (context.payrollExceptions > 0) {
    return {
      state: "action",
      kicker: "Your next action",
      title: `Resolve ${context.payrollExceptions} payroll exception${context.payrollExceptions === 1 ? "" : "s"}`,
      detail: "Open the register, understand every flagged employee and recalculate before submitting to Checker.",
      page: "Payroll",
      cta: "Review exceptions",
      tone: "danger",
      items: [],
    };
  }

  if (context.approval?.status === "Declined") {
    return {
      state: "action",
      kicker: "Returned by Checker",
      title: "Payroll needs changes before resubmission",
      detail: "The checker declined the previous review. Resolve the run, recalculate if needed, then submit a fresh approval.",
      page: "Payroll",
      cta: "Open returned payroll",
      tone: "review",
      items: [],
    };
  }

  return {
    state: "action",
    kicker: "Your next action",
    title: rank === 0 ? "HR inputs are clear. Prepare payroll." : "Payroll is ready for Checker",
    detail:
      rank === 0
        ? "The cutoff has no visible HR blockers. Open Payroll and prepare the register."
        : "The register has no visible exceptions. Submit this run to a different person for independent review.",
    page: "Payroll",
    cta: rank === 0 ? "Prepare payroll" : "Submit to Checker",
    tone: "active",
    items: [],
  };
}

function buildCheckerAction(context: PayrollHandoffContext, rank: number): RoleHandoffAction {
  if (rank === 2 && context.approval?.status === "Pending") {
    return {
      state: "action",
      kicker: "Your next action",
      title: "Payroll is ready for independent review",
      detail: `${context.run?.periodLabel ?? "The current payroll"} is waiting for a checker decision. Review the evidence, then approve or decline.`,
      page: "Approvals",
      cta: "Review payroll",
      tone: "review",
      items: [],
    };
  }

  if (rank < 2) {
    return waiting("Waiting on Payroll", "Checker review appears only after Payroll submits the prepared register.");
  }

  if (rank === 3) {
    return {
      state: "complete",
      kicker: "Checker handoff",
      title: "Your review is complete",
      detail: "The approved payroll is now with Owner for release.",
      tone: "success",
      items: [],
    };
  }

  return waiting("No checker action needed", "There is no payroll currently waiting for an independent decision.");
}

function buildOwnerAction(context: PayrollHandoffContext, rank: number): RoleHandoffAction {
  if (rank === 3 && context.approval?.status === "Approved") {
    return {
      state: "action",
      kicker: "Your next action",
      title: "Approved payroll is ready to release",
      detail: `${context.run?.periodLabel ?? "The current payroll"} cleared independent review. Open Payroll, review the release checklist and release it to employees.`,
      page: "Payroll",
      cta: "Release payroll",
      tone: "active",
      items: [],
    };
  }

  if (rank === 4) {
    return {
      state: "complete",
      kicker: "Release complete",
      title: "Payroll is available to employees",
      detail: "The released run no longer needs an owner action. Employees can access their payslips in self-service.",
      tone: "success",
      items: [],
    };
  }

  if (rank === 2) return waiting("Waiting on Checker", "Owner release stays locked until an independent checker approves the run.");
  if (rank <= 1) return waiting("Waiting on Payroll", "Owner release will appear after Payroll prepares the register and Checker approves it.");
  return waiting("No owner action needed", "There is no approved payroll waiting for release.");
}

function waiting(title: string, detail: string): RoleHandoffAction {
  return {
    state: "waiting",
    kicker: "Handoff status",
    title,
    detail,
    tone: "muted",
    items: [],
  };
}

function namesForPunchIssues(
  data: DashboardData,
  run: PayrollRun | PayrollHandoffRunSummary | null,
) {
  const ids = new Set(
    (data.punches ?? [])
      .filter((punch) => inRunPeriod(punch.workDate, run) && (!punch.timeIn || !punch.timeOut))
      .map((punch) => punch.employeeId),
  );
  return data.employees
    .filter((employee) => ids.has(employee.id))
    .slice(0, 3)
    .map((employee) => `${employee.firstName} ${employee.lastName}`);
}

function namesForPendingLeave(
  data: DashboardData,
  run: PayrollRun | PayrollHandoffRunSummary | null,
) {
  const ids = new Set(
    (data.leaveRequests ?? [])
      .filter(
        (request) =>
          request.status === "Pending" &&
          overlapsRunPeriod(request.startDate, request.endDate, run),
      )
      .map((request) => request.employeeId),
  );
  return data.employees
    .filter((employee) => ids.has(employee.id))
    .slice(0, 3)
    .map((employee) => `${employee.firstName} ${employee.lastName}`);
}

function employeesMissingGovernmentIds(data: DashboardData) {
  return data.employees
    .filter((employee) => employee.status === "Active")
    .flatMap((employee) => {
      const missing = [
        !employee.tin ? "TIN" : null,
        !employee.sssNo ? "SSS" : null,
        !employee.philHealthNo ? "PhilHealth" : null,
        !employee.pagIbigNo ? "Pag-IBIG" : null,
      ].filter((value): value is string => Boolean(value));
      return missing.length
        ? [{ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, missing }]
        : [];
    });
}

function currentOwner(rank: number) {
  if (rank === 1) return "Payroll";
  if (rank === 2) return "Checker";
  if (rank === 3) return "Owner";
  return "Employee";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}


function notificationRoleFor(
  data: DashboardData,
  role: string | null | undefined,
): CompanyHandoffRole | null {
  if (role === "owner" || role === "hr" || role === "payroll" || role === "checker") return role;
  if (role === "bookkeeper") return "payroll";
  if (role === "manager") return "checker";
  if (role === "admin") {
    const hasRelease = data.payrollRuns.some(
      (run) => run.status === "Ready for release" || run.status === "Releasing",
    );
    return hasRelease ? "owner" : "payroll";
  }
  return null;
}


function inRunPeriod(
  date: string,
  run: PayrollRun | PayrollHandoffRunSummary | null,
) {
  if (!run?.periodStart || !run?.periodEnd) return true;
  return date >= run.periodStart && date <= run.periodEnd;
}

function overlapsRunPeriod(
  startDate: string,
  endDate: string,
  run: PayrollRun | PayrollHandoffRunSummary | null,
) {
  if (!run?.periodStart || !run?.periodEnd) return true;
  return startDate <= run.periodEnd && endDate >= run.periodStart;
}
