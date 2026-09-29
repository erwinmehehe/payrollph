import type { DashboardData } from "@/components/workspace/types";
import { buildPayrollHandoff, type PayrollHandoffKey } from "@/lib/payroll-handoff";

export type RoleInboxRole = Extract<PayrollHandoffKey, "hr" | "payroll" | "checker" | "owner">;

export type RoleInboxItem = {
  id: string;
  title: string;
  detail: string;
  page: string;
  tone: "review" | "danger" | "active" | "success";
  cta: string;
};

export type RoleInbox = {
  role: RoleInboxRole;
  currentOwner: string;
  currentStage: PayrollHandoffKey;
  items: RoleInboxItem[];
};

function attendanceIssueCount(data: DashboardData) {
  return (data.punches ?? []).filter((punch) => {
    const status = punch.status.toLowerCase();
    return !["complete", "present", "ok", "approved"].includes(status);
  }).length;
}

function missingGovernmentIdCount(data: DashboardData) {
  return data.employees.filter(
    (employee) =>
      employee.status === "Active" &&
      (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
  ).length;
}

export function buildRoleInbox(data: DashboardData, role: RoleInboxRole): RoleInbox {
  const run =
    data.payrollRuns.find((item) => item.status !== "Released") ??
    data.payrollHandoffRun ??
    data.payrollRuns[0];

  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending").length;
  const attendanceIssues = attendanceIssueCount(data);
  const missingIds = missingGovernmentIdCount(data);
  const payrollExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception").length;
  const approvalTask = run
    ? data.tasks
        .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
        .sort((a, b) => b.id - a.id)[0] ?? null
    : null;

  const stages = buildPayrollHandoff(run, {
    hrIssues: pendingLeave + attendanceIssues + missingIds,
    payrollExceptions,
    approvalTask,
  });
  const current = stages.find((stage) => stage.state === "current") ?? stages[0];
  const items: RoleInboxItem[] = [];

  if (role === "hr") {
    if (attendanceIssues > 0) {
      items.push({
        id: "hr-attendance",
        title: `${attendanceIssues} attendance issue${attendanceIssues === 1 ? "" : "s"} need context`,
        detail: "Resolve incomplete or non-standard punches so the next payroll calculation has clean time inputs.",
        page: "Time & attendance",
        tone: "danger",
        cta: "Review attendance",
      });
    }
    if (pendingLeave > 0) {
      items.push({
        id: "hr-leave",
        title: `${pendingLeave} leave request${pendingLeave === 1 ? "" : "s"} still pending`,
        detail: "Clear leave decisions so paid days and balances stay current for payroll.",
        page: "Leave",
        tone: "review",
        cta: "Review leave",
      });
    }
    if (missingIds > 0) {
      items.push({
        id: "hr-ids",
        title: `${missingIds} active employee record${missingIds === 1 ? "" : "s"} missing filing IDs`,
        detail: "Complete TIN, SSS, PhilHealth or Pag-IBIG identifiers before statutory filing output is generated.",
        page: "People",
        tone: "review",
        cta: "Open people",
      });
    }
    if (items.length === 0 && current.key === "hr") {
      items.push({
        id: "hr-ready",
        title: "Cutoff inputs look ready for Payroll",
        detail: "Do one final attendance and leave review, then Payroll can continue the run.",
        page: "Time & attendance",
        tone: "success",
        cta: "Final review",
      });
    }
  }

  if (role === "payroll" && current.key === "payroll") {
    if (payrollExceptions > 0) {
      items.push({
        id: "payroll-exceptions",
        title: `${payrollExceptions} payroll exception${payrollExceptions === 1 ? "" : "s"} block handoff`,
        detail: "Inspect the affected employee entries and resolve the register before checker submission.",
        page: "Payroll",
        tone: "danger",
        cta: "Resolve exceptions",
      });
    } else {
      items.push({
        id: "payroll-submit",
        title: run ? `Prepare ${run.periodLabel} for checker review` : "Prepare the next payroll",
        detail:
          run?.status === "Needs review" || run?.status === "Processed"
            ? "The register is ready for maker review. Submit it to an independent checker when the cutoff is confirmed."
            : "Open Payroll to finish calculation and the checker handoff.",
        page: "Payroll",
        tone: "active",
        cta: run?.status === "Needs review" || run?.status === "Processed" ? "Submit for review" : "Open payroll",
      });
    }
  }

  if (role === "checker") {
    const pending = data.tasks.filter((task) => task.status === "Pending");
    if (pending.length > 0) {
      for (const task of pending.slice(0, 3)) {
        items.push({
          id: `checker-${task.id}`,
          title: task.title,
          detail: `${task.detail} · ${task.dueLabel}`,
          page: "Approvals",
          tone: task.priority === "High" ? "danger" : "review",
          cta: task.detail.includes("Payroll run #") ? "Review payroll" : "Review request",
        });
      }
    } else if (current.key === "checker") {
      items.push({
        id: "checker-review",
        title: run ? `Review ${run.periodLabel} independently` : "Open checker review",
        detail: "Inspect the submitted payroll, assurance findings and audit context before deciding.",
        page: "Approvals",
        tone: "review",
        cta: "Open approvals",
      });
    }
  }

  if (role === "owner" && current.key === "owner") {
    items.push({
      id: "owner-release",
      title: run ? `${run.periodLabel} is ready for release` : "Payroll is ready for release",
      detail: "Checker approval is complete. Review the release checklist and make the final release decision.",
      page: "Payroll",
      tone: "active",
      cta: "Review release",
    });
  }

  return {
    role,
    currentOwner: current.owner,
    currentStage: current.key,
    items,
  };
}

export function isRoleInboxRole(role: string | null | undefined): role is RoleInboxRole {
  return role === "owner" || role === "hr" || role === "payroll" || role === "checker";
}
