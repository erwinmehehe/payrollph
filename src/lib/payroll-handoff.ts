import type { PayrollRun, Task } from "@/components/workspace/types";

export type PayrollHandoffKey = "hr" | "payroll" | "checker" | "owner" | "employee";
export type PayrollHandoffState = "done" | "current" | "pending";

export type PayrollHandoffStage = {
  key: PayrollHandoffKey;
  label: string;
  owner: string;
  state: PayrollHandoffState;
  detail: string;
};

type HandoffContext = {
  hrIssues?: number;
  payrollExceptions?: number;
  approvalTask?: Pick<Task, "approver" | "status"> | null;
};

const STAGES: Array<{ key: PayrollHandoffKey; label: string; owner: string }> = [
  { key: "hr", label: "Inputs ready", owner: "HR" },
  { key: "payroll", label: "Payroll prepared", owner: "Payroll" },
  { key: "checker", label: "Independent review", owner: "Checker" },
  { key: "owner", label: "Release", owner: "Owner" },
  { key: "employee", label: "Payslip available", owner: "Employee" },
];

export function payrollHandoffRank(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized === "released") return 4;
  if (normalized === "ready for release" || normalized === "approved") return 3;
  if (normalized === "pending approval" || normalized === "submitted") return 2;
  if (
    normalized === "needs review" ||
    normalized === "processing" ||
    normalized === "calculating" ||
    normalized === "calculated" ||
    normalized === "ready"
  ) {
    return 1;
  }
  return 0;
}

export function buildPayrollHandoff(
  run: Pick<PayrollRun, "status" | "periodLabel" | "payDate" | "exceptions"> | null | undefined,
  context: HandoffContext = {},
): PayrollHandoffStage[] {
  const rank = payrollHandoffRank(run?.status);
  const hrIssues = Math.max(0, context.hrIssues ?? 0);
  const payrollExceptions = Math.max(0, context.payrollExceptions ?? Number(run?.exceptions ?? 0));
  const approver = context.approvalTask?.approver;

  const details: Record<PayrollHandoffKey, string> = {
    hr:
      rank > 0
        ? "Cutoff inputs have moved to payroll."
        : hrIssues
          ? `${hrIssues} people or attendance item(s) still need HR attention.`
          : "People, attendance and leave inputs are ready for payroll.",
    payroll:
      rank > 1
        ? "The prepared register has been handed to an independent checker."
        : rank === 1
          ? payrollExceptions
            ? `${payrollExceptions} payroll exception(s) need resolution before handoff.`
            : "The register is being finalized for checker review."
          : "Payroll starts after HR closes the cutoff inputs.",
    checker:
      rank > 2
        ? "Independent review is complete."
        : rank === 2
          ? approver
            ? `Assigned to ${approver} for an independent decision.`
            : "An independent checker is reviewing the submitted payroll."
          : "Checker review starts after Payroll submits the run.",
    owner:
      rank > 3
        ? "The approved payroll has been released."
        : rank === 3
          ? "Checker approval is complete. Owner/admin can now release payroll."
          : "Release stays locked until checker approval is complete.",
    employee:
      rank === 4
        ? "Employees can now see the released payslip in self-service."
        : "No payroll amounts are exposed to employees until the run is released.",
  };

  return STAGES.map((stage, index) => ({
    ...stage,
    state: index < rank ? "done" : index === rank ? "current" : "pending",
    detail: details[stage.key],
  }));
}

export function employeePayStatusLabel(status: string | null | undefined) {
  const rank = payrollHandoffRank(status);
  if (rank === 4) return "Payslip available";
  if (rank === 3) return "Approved, waiting for release";
  if (rank === 2) return "With an independent checker";
  if (rank === 1) return "Payroll is being finalized";
  return "Inputs are being prepared";
}
