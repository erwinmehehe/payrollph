import { FIRST_PAYROLL_STEPS } from "./first-payroll-journey";
export type FirstPayrollReadinessItem = {
  key: "workspace" | "employees" | "payout" | "payroll-officer" | "checker";
  label: string;
  detail: string;
  ready: boolean;
  actionPage: "Settings" | "People";
  actionLabel: string;
};

export type FirstPayrollReadiness = {
  ready: boolean;
  completed: number;
  total: number;
  activeEmployees: number;
  employeesMissingPayout: number;
  payrollOfficerCount: number;
  checkerCount: number;
  firstPayrollStarted: boolean;
  firstPayrollReleased: boolean;
  payrollRunCount: number;
  items: FirstPayrollReadinessItem[];
};

type EmployeeInput = {
  status: string;
  bankAccount?: string | null;
  bankCode?: string | null;
};

type MembershipInput = {
  role: string;
};

export function buildFirstPayrollReadiness(input: {
  workspaceName: string;
  employees: EmployeeInput[];
  memberships: MembershipInput[];
  payrollStatuses: string[];
}): FirstPayrollReadiness {
  const activeEmployees = input.employees.filter((employee) => employee.status === "Active");
  const employeesMissingPayout = activeEmployees.filter(
    (employee) => !employee.bankAccount?.trim() || !employee.bankCode?.trim(),
  ).length;
  const payrollOfficerCount = input.memberships.filter((member) => member.role === "payroll").length;
  const checkerCount = input.memberships.filter((member) => member.role === "checker").length;
  const workspaceReady = input.workspaceName.trim().length >= 2;

  const step = (key: string) => FIRST_PAYROLL_STEPS.find(s => s.key === key)!;
  const items: FirstPayrollReadinessItem[] = [
    {
      key: "workspace",
      label: step("company").title,
      detail: workspaceReady
        ? `${input.workspaceName} is ready for payroll setup.`
        : "Complete the company workspace details before payroll.",
      ready: workspaceReady,
      actionPage: "Settings",
      actionLabel: step("company").actionLabel,
    },
    {
      key: "employees",
      label: step("people").title,
      detail:
        activeEmployees.length > 0
          ? `${activeEmployees.length} active employee${activeEmployees.length === 1 ? "" : "s"} in the payroll roster.`
          : "Add or import at least one active employee.",
      ready: activeEmployees.length > 0,
      actionPage: "People",
      actionLabel: step("people").actionLabel,
    },
    {
      key: "payout",
      label: "Payout details",
      detail:
        activeEmployees.length === 0
          ? "Add employees first, then complete their bank payout details."
          : employeesMissingPayout === 0
            ? "Every active employee has bank and payout details."
            : `${employeesMissingPayout} active employee${employeesMissingPayout === 1 ? " is" : "s are"} missing bank or payout details.`,
      ready: activeEmployees.length > 0 && employeesMissingPayout === 0,
      actionPage: "People",
      actionLabel: "Complete payout details",
    },
    {
      key: "payroll-officer",
      label: "Payroll Officer",
      detail:
        payrollOfficerCount > 0
          ? `${payrollOfficerCount} Payroll Officer${payrollOfficerCount === 1 ? "" : "s"} assigned.`
          : "Invite a Payroll Officer to prepare and submit payroll.",
      ready: payrollOfficerCount > 0,
      actionPage: "Settings",
      actionLabel: "Team & access",
    },
    {
      key: "checker",
      label: "Independent Checker",
      detail:
        checkerCount > 0
          ? `${checkerCount} Checker${checkerCount === 1 ? "" : "s"} assigned.`
          : "Invite a Checker for independent payroll review.",
      ready: checkerCount > 0,
      actionPage: "Settings",
      actionLabel: "Team & access",
    },
  ];

  const completed = items.filter((item) => item.ready).length;

  return {
    ready: completed === items.length,
    completed,
    total: items.length,
    activeEmployees: activeEmployees.length,
    employeesMissingPayout,
    payrollOfficerCount,
    checkerCount,
    firstPayrollStarted: input.payrollStatuses.length > 0,
    payrollRunCount: input.payrollStatuses.length,
    firstPayrollReleased: input.payrollStatuses.some((status) => status === "Released"),
    items,
  };
}
