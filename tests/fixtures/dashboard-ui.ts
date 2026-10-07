import type {
  DashboardData,
  PayrollRun,
} from "../../src/components/workspace/types";

export const sampleRun: PayrollRun = {
  id: 1,
  periodLabel: "October 1–15, 2026",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-15",
  scopeLabel: "Company-wide",
  status: "Processed",
  payDate: "2026-10-15",
  employeeCount: 128,
  grossPay: "4214320",
  netPay: "3842180",
  exceptions: 1,
  ruleVersion: "2026.1",
};
export const dashboardFixture = {
  user: { id: 1, name: "Juan Dela Cruz", role: "payroll" },
  selectedOrganization: {
    id: 1,
    name: "Acme Philippines, Inc.",
    legalName: "Acme Philippines, Inc.",
    accountType: "business",
    plan: "Scale",
    employeeCount: 128,
    color: "#0866ed",
  },
  organizations: [],
  employees: Array.from({ length: 128 }, (_, i) => ({
    id: i + 1,
    employeeNo: `EMP-${i + 1}`,
    firstName: "Maria",
    lastName: `Santos ${i + 1}`,
    title: "Team member",
    employmentType: "Regular",
    status: "Active",
    avatarInitials: "MS",
    basicRate: "28000",
    bankCode: "BDO",
    bankAccount: "••••1234",
    mwe: false,
  })),
  payrollRuns: [
    sampleRun,
    {
      ...sampleRun,
      id: 2,
      periodLabel: "September 16–30, 2026",
      payDate: "2026-09-30",
      status: "Released",
      netPay: "3758600",
      exceptions: 0,
    },
  ],
  payrollEntries: [],
  tasks: [],
  auditEvents: [],
  plans: [],
  templates: [],
  advisories: [],
  punches: [
    { id: 1, employeeId: 1, workDate: "2026-10-07", status: "incomplete" },
    { id: 2, employeeId: 2, workDate: "2026-10-07", status: "incomplete" },
  ],
} as unknown as DashboardData;

export const employeeFixture = {
  employee: { firstName: "Maria" },
  nextPay: {
    payDate: "2026-10-15",
    period: "October 1–15, 2026",
    label: "In progress",
  },
  payslips: [
    {
      entryId: 10,
      period: "September 16–30, 2026",
      net: "28450.00",
      payDate: "2026-09-30",
    },
  ],
  attendance: {
    completeCount: 20,
    recent: Array.from({ length: 22 }, () => ({ workDate: "2026-09-30" })),
    today: null,
  },
  leave: {
    balances: [
      { leaveType: "Vacation leave", available: 10 },
      { leaveType: "Sick leave", available: 5 },
    ],
    requests: [],
  },
};
